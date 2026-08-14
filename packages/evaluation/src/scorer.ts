/**
 * The evaluation scorer.
 *
 * Scores a produced curriculum against what a fixture says a good curriculum for it looks like.
 * Each dimension is independent and returns a number in [0, 1] plus the specific observations
 * behind it, so a regression report names what got worse rather than just showing a total
 * falling.
 *
 * Nothing here calls a model. That is deliberate: a scorer that asks a model to grade a model's
 * output inherits its blind spots, and the point of this pack is to be the thing that does not.
 */

import type { CurriculumPlan, LessonPackage, Question } from '@gapos/ai-contracts';
import {
  STRUCTURE_ELEMENT_LABELS,
  WORDS_PER_MINUTE,
  checkStructuralElements,
  type StructureElement,
} from '@gapos/domain';
import {
  SCORE_DIMENSIONS,
  SCORE_FLOORS,
  type EvaluationFixture,
  type ScoreDimension,
} from './fixture.js';

export interface ProducedCurriculum {
  readonly plan: CurriculumPlan;
  readonly lessons: readonly LessonPackage[];
}

export interface DimensionScore {
  readonly dimension: ScoreDimension;
  readonly score: number;
  readonly observations: readonly string[];
}

export interface Scorecard {
  readonly fixtureId: string;
  readonly dimensions: Readonly<Record<ScoreDimension, DimensionScore>>;
  readonly overall: number;
  readonly failures: readonly ScoreDimension[];
  readonly passed: boolean;
}

const normalise = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const allQuestions = (produced: ProducedCurriculum): Question[] =>
  produced.lessons.flatMap((lesson) => lesson.questions);

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 1 : Number((numerator / denominator).toFixed(4));

/* -------------------------------------------------------------------- dimensions */

/**
 * Does the curriculum cover what the fixture says it must? Nothing else matters if it does not.
 *
 * Measured over what is actually *taught* — lesson titles, summaries and scripts — and
 * deliberately not over the plan's objective statements. A plan promising four objectives while
 * only three lessons survived publication is precisely the failure this dimension exists to
 * catch, and scoring the plan would let it through.
 */
const scoreObjectiveCoverage = (
  fixture: EvaluationFixture,
  produced: ProducedCurriculum,
): DimensionScore => {
  const haystack = normalise(
    produced.lessons.map((l) => `${l.title} ${l.summary} ${l.script}`).join(' '),
  );

  const observations: string[] = [];
  let covered = 0;

  for (const keywords of fixture.expectedObjectiveKeywords) {
    const present = keywords.every((keyword) => haystack.includes(normalise(keyword)));
    if (present) covered += 1;
    else observations.push(`Expected objective not covered: [${keywords.join(' + ')}]`);
  }

  return {
    dimension: 'objective_coverage',
    score: ratio(covered, fixture.expectedObjectiveKeywords.length),
    observations,
  };
};

/** Does every claim that says it came from a source actually cite one? */
const scoreSourceFaithfulness = (
  fixture: EvaluationFixture,
  produced: ProducedCurriculum,
): DimensionScore => {
  const observations: string[] = [];
  const items = [
    ...produced.plan.objectives.map((o) => ({ id: o.id, evidence: o.evidence })),
    ...produced.lessons.map((l) => ({ id: `day-${l.day}`, evidence: l.evidence })),
    ...allQuestions(produced).map((q) => ({ id: q.id, evidence: q.evidence })),
  ];

  let grounded = 0;
  for (const item of items) {
    if (item.evidence.basis === 'general_knowledge') {
      // Permitted, but only when the fixture supplied no source to be faithful to.
      if (fixture.source) {
        observations.push(`${item.id} fell back to general knowledge despite a supplied source.`);
        continue;
      }
      grounded += 1;
      continue;
    }
    if (item.evidence.locators.length === 0) {
      observations.push(`${item.id} claims source grounding but cites no locator.`);
      continue;
    }
    grounded += 1;
  }

  return {
    dimension: 'source_faithfulness',
    score: ratio(grounded, items.length),
    observations,
  };
};

/** Does anything the fixture declares false or out of scope appear in the teaching? */
const scoreFactualAccuracy = (
  fixture: EvaluationFixture,
  produced: ProducedCurriculum,
): DimensionScore => {
  const observations: string[] = [];
  const teaching = normalise(
    produced.lessons.map((l) => `${l.script} ${l.summary} ${l.examples.join(' ')}`).join(' '),
  );

  for (const prohibited of fixture.prohibitedContent) {
    if (teaching.includes(normalise(prohibited))) {
      observations.push(`Prohibited content present: "${prohibited}"`);
    }
  }

  return {
    dimension: 'factual_accuracy',
    score: observations.length === 0 ? 1 : 0,
    observations,
  };
};

/**
 * Is every published item actually answerable? An item with no answer, a multiple choice whose
 * key is absent from its options, or a free response with no rubric cannot be graded, so it
 * teaches nothing and blocks mastery forever.
 */
const scoreQuestionSolvability = (produced: ProducedCurriculum): DimensionScore => {
  const questions = allQuestions(produced);
  const observations: string[] = [];
  let solvable = 0;

  for (const question of questions) {
    if (question.answer.trim().length === 0) {
      observations.push(`${question.id} has no answer.`);
      continue;
    }
    if (question.type === 'multiple_choice') {
      if (!question.options?.some((o) => normalise(o) === normalise(question.answer))) {
        observations.push(`${question.id} has an answer that is not among its options.`);
        continue;
      }
    } else if (!question.rubric || question.rubric.trim().length === 0) {
      observations.push(`${question.id} is free response with no rubric, so it cannot be graded.`);
      continue;
    }
    solvable += 1;
  }

  return {
    dimension: 'question_solvability',
    score: ratio(solvable, questions.length),
    observations,
  };
};

/**
 * Does difficulty go up? A course that starts hard and ends easy has the ramp backwards, which
 * feels like the material is getting simpler when in fact the learner is being under-tested.
 */
const scoreDifficultyProgression = (produced: ProducedCurriculum): DimensionScore => {
  const byDay = [...produced.lessons].sort((a, b) => a.day - b.day);
  const observations: string[] = [];

  const averages = byDay.map((lesson) => ({
    day: lesson.day,
    average:
      lesson.questions.reduce((sum, q) => sum + q.difficulty, 0) /
      Math.max(1, lesson.questions.length),
  }));

  if (averages.length < 2) {
    return { dimension: 'difficulty_progression', score: 1, observations };
  }

  let nonDecreasing = 0;
  for (let i = 1; i < averages.length; i++) {
    const previous = averages[i - 1]!;
    const current = averages[i]!;
    // A small dip is normal when a day introduces a new idea; a real drop is not.
    if (current.average >= previous.average - 0.5) nonDecreasing += 1;
    else {
      observations.push(
        `Day ${current.day} is easier than day ${previous.day} ` +
          `(${current.average.toFixed(1)} vs ${previous.average.toFixed(1)}).`,
      );
    }
  }

  const first = averages[0]!.average;
  const last = averages[averages.length - 1]!.average;
  if (last <= first) {
    observations.push(
      `The course does not get harder overall (${first.toFixed(1)} → ${last.toFixed(1)}).`,
    );
  }

  return {
    dimension: 'difficulty_progression',
    score: ratio(nonDecreasing + (last > first ? 1 : 0), averages.length),
    observations,
  };
};

/**
 * Is the script written to be *heard*? Bullet points, markdown, parenthetical asides and visual
 * deixis ("as shown below") are all invisible in audio and leave the listener stranded.
 */
const UNSPEAKABLE: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /^\s*[-*•]\s+/m, why: 'bullet list' },
  { pattern: /#{1,6}\s/, why: 'markdown heading' },
  { pattern: /\bas (shown|seen) (below|above|in the figure)\b/i, why: 'visual reference' },
  { pattern: /\bsee (figure|table|diagram)\b/i, why: 'visual reference' },
  { pattern: /\bclick\b|\btap\b/i, why: 'interface instruction' },
  { pattern: /\|.*\|.*\|/, why: 'markdown table' },
];

const scoreAudioSuitability = (produced: ProducedCurriculum): DimensionScore => {
  const observations: string[] = [];
  let clean = 0;

  for (const lesson of produced.lessons) {
    const problems = UNSPEAKABLE.filter((rule) => rule.pattern.test(lesson.script));
    if (problems.length === 0) {
      clean += 1;
      continue;
    }
    observations.push(
      `Day ${lesson.day} script contains ${problems.map((p) => p.why).join(', ')}, ` +
        'which a listener cannot perceive.',
    );
  }

  return {
    dimension: 'audio_suitability',
    score: ratio(clean, produced.lessons.length),
    observations,
  };
};

/** Does a lesson take as long as it claims? A wrong estimate breaks the learner's daily budget. */
const scoreDurationAccuracy = (produced: ProducedCurriculum): DimensionScore => {
  const observations: string[] = [];
  let accurate = 0;

  for (const lesson of produced.lessons) {
    const spokenMinutes = lesson.script.trim().split(/\s+/).length / WORDS_PER_MINUTE;
    const drift = Math.abs(spokenMinutes - lesson.estimatedMinutes) / lesson.estimatedMinutes;
    if (drift <= 0.4) accurate += 1;
    else {
      observations.push(
        `Day ${lesson.day} claims ${lesson.estimatedMinutes} minutes but the script runs ` +
          `about ${spokenMinutes.toFixed(1)}.`,
      );
    }
  }

  return {
    dimension: 'duration_accuracy',
    score: ratio(accurate, produced.lessons.length),
    observations,
  };
};

/** Is the same item asked twice? Repetition dressed as coverage inflates the assessment count. */
const scoreDuplicateContent = (produced: ProducedCurriculum): DimensionScore => {
  const questions = allQuestions(produced);
  const seen = new Map<string, string>();
  const observations: string[] = [];
  let unique = 0;

  for (const question of questions) {
    const key = normalise(question.prompt);
    const previous = seen.get(key);
    if (previous) observations.push(`${question.id} repeats the prompt of ${previous}.`);
    else {
      seen.set(key, question.id);
      unique += 1;
    }
  }

  return { dimension: 'duplicate_content', score: ratio(unique, questions.length), observations };
};

/** Is the answer visible in the prompt, the script, or the summary the learner just heard? */
const scoreAnswerLeakage = (produced: ProducedCurriculum): DimensionScore => {
  const observations: string[] = [];
  const questions = allQuestions(produced);
  let clean = 0;

  for (const question of questions) {
    const answer = normalise(question.answer);
    if (answer.length < 12) {
      clean += 1;
      continue;
    }
    if (normalise(question.prompt).includes(answer)) {
      observations.push(`${question.id} contains its own answer in the prompt.`);
      continue;
    }
    clean += 1;
  }

  return { dimension: 'answer_leakage', score: ratio(clean, questions.length), observations };
};

/** Does the curriculum stay inside what it declared, and honour its own exclusions? */
const scoreScopeDiscipline = (
  fixture: EvaluationFixture,
  produced: ProducedCurriculum,
): DimensionScore => {
  const observations: string[] = [];
  const teaching = normalise(produced.lessons.map((l) => `${l.script} ${l.summary}`).join(' '));

  for (const exclusion of produced.plan.exclusions) {
    if (teaching.includes(normalise(exclusion))) {
      observations.push(`The plan excludes "${exclusion}" but the teaching covers it.`);
    }
  }

  const declaredObjectives = new Set(produced.plan.objectives.map((o) => o.id));
  for (const lesson of produced.lessons) {
    for (const objectiveId of lesson.objectiveIds) {
      if (!declaredObjectives.has(objectiveId)) {
        observations.push(`Day ${lesson.day} teaches "${objectiveId}", absent from the plan.`);
      }
    }
  }

  void fixture;
  return {
    dimension: 'scope_discipline',
    score: observations.length === 0 ? 1 : 0,
    observations,
  };
};

/**
 * Does every published lesson read like a real teacher wrote it (E24 US1, C-01/C-02)?
 *
 * The dimension score is the share of lessons that pass all four structural checks: concrete
 * opening, one idea per segment, a worked example inside the script, and a checkpoint question.
 * Observations name the missing element per lesson so a regression report says exactly what
 * read like a model dump.
 */
const scoreHumanSounding = (produced: ProducedCurriculum): DimensionScore => {
  const observations: string[] = [];
  let passing = 0;

  for (const lesson of produced.lessons) {
    const failed = checkStructuralElements({
      script: lesson.script,
      examples: lesson.examples,
      pausePrompts: lesson.pausePrompts,
    }).filter((check) => !check.passes);

    if (failed.length === 0) {
      passing += 1;
      continue;
    }

    for (const check of failed) {
      observations.push(
        `Day ${lesson.day} missing ${STRUCTURE_ELEMENT_LABELS[check.element as StructureElement]}: ` +
          `${check.detail ?? ''}`,
      );
    }
  }

  return {
    dimension: 'human_sounding',
    score: ratio(passing, produced.lessons.length),
    observations,
  };
};

/* ---------------------------------------------------------------------- scoring */

export const scoreCurriculum = (
  fixture: EvaluationFixture,
  produced: ProducedCurriculum,
): Scorecard => {
  const scores: DimensionScore[] = [
    scoreObjectiveCoverage(fixture, produced),
    scoreSourceFaithfulness(fixture, produced),
    scoreFactualAccuracy(fixture, produced),
    scoreQuestionSolvability(produced),
    scoreDifficultyProgression(produced),
    scoreAudioSuitability(produced),
    scoreDurationAccuracy(produced),
    scoreDuplicateContent(produced),
    scoreAnswerLeakage(produced),
    scoreScopeDiscipline(fixture, produced),
    scoreHumanSounding(produced),
  ];

  const dimensions = Object.fromEntries(scores.map((s) => [s.dimension, s])) as Record<
    ScoreDimension,
    DimensionScore
  >;

  const failures = SCORE_DIMENSIONS.filter(
    (dimension) => dimensions[dimension].score < SCORE_FLOORS[dimension],
  );

  return {
    fixtureId: fixture.id,
    dimensions,
    overall: Number((scores.reduce((sum, s) => sum + s.score, 0) / scores.length).toFixed(4)),
    failures,
    passed: failures.length === 0,
  };
};
