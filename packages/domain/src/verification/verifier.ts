/**
 * Artefact verification.
 *
 * Section 9.6 of the spec is emphatic that the verifier must not merely critique the generator's
 * prose. Two kinds of check live here:
 *
 *   - **Structural checks**, which are deterministic and run without a model: answer leakage,
 *     distractor validity, difficulty against the blueprint, glossary drift, duration estimates,
 *     objective coverage. These are free, instant, and cannot themselves hallucinate.
 *   - **Independent solutions**, which do need a model. The pipeline obtains them through the
 *     adapter and passes them in; this module decides what they mean.
 *
 * A verifier can never approve its own output: `assertIndependentVerifier` refuses a report whose
 * producer is the generator that made the artefact.
 */

import { DomainError } from '../errors.js';
import {
  STRUCTURE_ELEMENT_LABELS,
  checkStructuralElements,
  type StructureElement,
} from '../curriculum/script-structure.js';

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export type FindingCategory =
  | 'independent_solution'
  | 'distractor_validity'
  | 'rubric_tolerance'
  | 'answer_leakage'
  | 'difficulty_match'
  | 'logical_consistency'
  | 'source_support'
  | 'spoken_clarity'
  | 'duration_estimate'
  | 'objective_coverage'
  | 'prompt_injection'
  | 'script_structure'
  | 'unsupported_claim';

export interface Finding {
  readonly category: FindingCategory;
  readonly severity: FindingSeverity;
  readonly targetId: string;
  readonly finding: string;
  readonly suggestedRepair?: string;
}

export interface VerifiableQuestion {
  readonly id: string;
  readonly objectiveId: string;
  readonly type: 'multiple_choice' | 'short_answer' | 'worked_problem';
  readonly role: 'retrieval' | 'application' | 'transfer';
  readonly difficulty: number;
  readonly prompt: string;
  readonly options?: readonly string[];
  readonly answer: string;
  readonly rubric?: string;
  readonly acceptableAlternatives: readonly string[];
  readonly evidence: {
    readonly basis: 'source' | 'general_knowledge';
    readonly locators: readonly unknown[];
  };
}

export interface VerifiableLesson {
  readonly id: string;
  readonly day: number;
  readonly objectiveIds: readonly string[];
  readonly script: string;
  readonly transcript: string;
  readonly estimatedMinutes: number;
  readonly questions: readonly VerifiableQuestion[];
  /** Declared worked examples; the script must actually work one (FR-003, E24 US1). */
  readonly examples?: readonly string[];
  /** Checkpoint questions embedded in the audio (FR-004, E24 US1). */
  readonly pausePrompts?: readonly { prompt: string }[];
}

export interface VerificationContext {
  /** The plan's shared glossary. A term outside it in one lesson is drift across parallel days. */
  readonly glossaryTerms: readonly string[];
  /** Target difficulty per objective from the assessment blueprint. */
  readonly targetDifficulty: ReadonlyMap<string, number>;
  /** Objectives the lesson is contracted to teach. */
  readonly plannedObjectiveIds: readonly string[];
  /** Independent answers obtained from a separately prompted model. */
  readonly independentSolutions?: readonly {
    questionId: string;
    answer: string;
    agrees: boolean;
  }[];
  readonly injectionSignals?: readonly { chunkId: string; excerpt: string }[];
}

/** Spoken-word rate used to check a script against its claimed duration. */
export const WORDS_PER_MINUTE = 150;
const DURATION_TOLERANCE = 0.35;

const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

const normalise = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Words that carry no claim on their own. Removed before comparing two options.
 *
 * Deliberately excludes single letters: in this domain `A` and `B` are set names as often as
 * they are articles, and dropping them would make "A subset of B" and "B subset of A" compare
 * equal — a false accusation is worse than a missed one, because it fails a correct item.
 */
const STOPWORDS = new Set([
  'of',
  'is',
  'are',
  'be',
  'the',
  'and',
  'or',
  'an',
  'that',
  'to',
  'in',
  'on',
  'as',
  'it',
  'also',
  'then',
  'so',
  'both',
  'but',
  'when',
  'if',
  'which',
  'there',
  'this',
  'these',
  'those',
  'for',
  'with',
  'at',
]);

/** Universal quantifiers collapse together: "every", "each" and "all" make the same claim. */
const QUANTIFIER_SYNONYMS: Record<string, string> = {
  every: 'universal',
  each: 'universal',
  all: 'universal',
};

/**
 * The content words of a phrase, in order. Order is preserved deliberately: comparing sets would
 * make "A subset of B" and "B subset of A" identical.
 */
const contentSequence = (text: string): string[] =>
  normalise(text)
    .split(' ')
    .filter((word) => word.length > 0 && !STOPWORDS.has(word))
    .map((word) => QUANTIFIER_SYNONYMS[word] ?? word);

const sameContent = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((word, index) => word === b[index]);

/**
 * Answer leakage: the published answer, or a distinctive part of it, is visible in the prompt.
 * Short answers are excluded from the substring test because a one-word answer legitimately
 * appears in a well-written prompt ("Is this relation reflexive?").
 */
const detectLeakage = (question: VerifiableQuestion): Finding | undefined => {
  const prompt = normalise(question.prompt);
  const answer = normalise(question.answer);
  if (answer.length < 12) return undefined;

  if (prompt.includes(answer)) {
    return {
      category: 'answer_leakage',
      severity: 'critical',
      targetId: question.id,
      finding: 'The published answer appears verbatim in the prompt.',
      suggestedRepair: 'Rewrite the prompt so it asks for the answer rather than containing it.',
    };
  }

  // A long distinctive phrase from the answer showing up in the prompt is the same failure with
  // a coat on.
  const answerWords = answer.split(' ');
  if (answerWords.length >= 6) {
    for (let i = 0; i + 6 <= answerWords.length; i++) {
      const phrase = answerWords.slice(i, i + 6).join(' ');
      if (prompt.includes(phrase)) {
        return {
          category: 'answer_leakage',
          severity: 'high',
          targetId: question.id,
          finding: `A six-word phrase from the answer appears in the prompt: "${phrase}".`,
          suggestedRepair: 'Remove the giveaway phrase from the prompt.',
        };
      }
    }
  }

  return undefined;
};

const checkDistractors = (question: VerifiableQuestion): Finding[] => {
  if (question.type !== 'multiple_choice' || !question.options) return [];
  const findings: Finding[] = [];
  const answer = normalise(question.answer);
  const seen = new Map<string, number>();

  for (const option of question.options) {
    const key = normalise(option);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  for (const [key, count] of seen) {
    if (count > 1) {
      findings.push({
        category: 'distractor_validity',
        severity: 'high',
        targetId: question.id,
        finding: `Option "${key}" appears ${count} times.`,
        suggestedRepair: 'Replace the duplicate with a distinct incorrect option.',
      });
    }
  }

  if (!seen.has(answer)) {
    findings.push({
      category: 'distractor_validity',
      severity: 'critical',
      targetId: question.id,
      finding: 'The published answer is not one of the options.',
      suggestedRepair: 'Add the correct answer to the options, or correct the answer key.',
    });
  }

  // A distractor that only rewords the key gives the item two correct options.
  const answerContent = contentSequence(question.answer);
  for (const option of question.options) {
    if (normalise(option) === answer) continue;
    if (sameContent(contentSequence(option), answerContent)) {
      findings.push({
        category: 'distractor_validity',
        severity: 'critical',
        targetId: question.id,
        finding: `Option "${option}" restates the correct answer, so the item has two right answers.`,
        suggestedRepair: 'Replace it with a genuinely incorrect condition.',
      });
    }
  }

  return findings;
};

const checkRubricTolerance = (question: VerifiableQuestion): Finding[] => {
  if (question.type === 'multiple_choice') return [];
  const findings: Finding[] = [];

  if (!question.rubric) {
    findings.push({
      category: 'rubric_tolerance',
      severity: 'critical',
      targetId: question.id,
      finding: 'A free-response question was published without a rubric.',
      suggestedRepair: 'Add a rubric stating what earns credit.',
    });
    return findings;
  }

  // A rubric that only accepts the exact published wording will reject valid reasoning.
  if (question.acceptableAlternatives.length === 0 && question.rubric.length < 40) {
    findings.push({
      category: 'rubric_tolerance',
      severity: 'medium',
      targetId: question.id,
      finding:
        'The rubric is terse and no alternative phrasings are listed, so valid reasoning ' +
        'expressed differently is likely to be marked wrong.',
      suggestedRepair:
        'State what must be present rather than the exact wording, or list alternatives.',
    });
  }

  return findings;
};

const checkDifficulty = (question: VerifiableQuestion, context: VerificationContext): Finding[] => {
  const target = context.targetDifficulty.get(question.objectiveId);
  if (target === undefined) return [];
  if (Math.abs(question.difficulty - target) <= 2) return [];
  return [
    {
      category: 'difficulty_match',
      severity: 'medium',
      targetId: question.id,
      finding: `Difficulty ${question.difficulty} is far from the blueprint target ${target}.`,
      suggestedRepair: `Rewrite the item at approximately difficulty ${target}.`,
    },
  ];
};

/**
 * A source-grounded item must cite a locator, and it must never cite a chunk that was flagged as
 * instruction-like (FR-010, E24 US2): source text is evidence, never instruction, so an item
 * built on an injected chunk is refused — repaired or excluded, never published.
 */
const checkSourceSupport = (
  question: VerifiableQuestion,
  context: VerificationContext,
): Finding[] => {
  if (question.evidence.basis === 'general_knowledge') return [];
  const findings: Finding[] = [];

  if (question.evidence.locators.length === 0) {
    findings.push({
      category: 'source_support',
      severity: 'high',
      targetId: question.id,
      finding: 'The item claims source grounding but cites no locator.',
      suggestedRepair: 'Cite the chunk the item is drawn from, or relabel it general knowledge.',
    });
  }

  const injected = new Set((context.injectionSignals ?? []).map((signal) => signal.chunkId));
  for (const raw of question.evidence.locators) {
    const locator = raw as { chunkId?: string };
    if (locator.chunkId !== undefined && injected.has(locator.chunkId)) {
      findings.push({
        category: 'prompt_injection',
        severity: 'critical',
        targetId: question.id,
        finding:
          `The item cites chunk ${locator.chunkId}, which contains instruction-like text; ` +
          'evidence from an injected chunk is never taught.',
        suggestedRepair: 'Regenerate the item without citing the injected chunk.',
      });
    }
  }

  return findings;
};

const checkGlossary = (lesson: VerifiableLesson, context: VerificationContext): Finding[] => {
  if (context.glossaryTerms.length === 0) return [];
  const script = normalise(lesson.script);
  const findings: Finding[] = [];

  // Drift is a glossary term that has *disappeared* — the lesson discusses the concept
  // but invented its own wording instead of the agreed term. A lesson that never
  // discusses the concept at all is NOT a finding: the plan's shared glossary is a
  // curriculum-wide terminology contract, not a checklist every day must recite.
  // (Fixed E26: previously every lesson was required to contain every glossary term,
  // which excluded whole courses — e.g. "Eigendecomposition" demanded inside a
  // Day-1 sets lesson — even when the lesson had nothing to do with the concept.)
  const expected = context.glossaryTerms.filter((term) => {
    const normalisedTerm = normalise(term);
    if (normalisedTerm.split(' ').length > 3) return false;
    if (script.includes(normalisedTerm)) return false;
    // The spoken lesson is about the concept (or close to it) but does not use the
    // agreed term: a meaningful prefix of the term appears in the script. Question
    // prompts are deliberately excluded — they are authored against the transcript
    // and routinely name concepts the spoken script does not.
    const prefix = normalisedTerm.split(' ')[0]!;
    return prefix.length >= 4 && script.includes(prefix);
  });

  for (const term of expected) {
    findings.push({
      category: 'spoken_clarity',
      severity: 'low',
      targetId: lesson.id,
      finding: `The shared glossary term "${term}" does not appear in this lesson's script.`,
    });
  }

  return findings;
};

const checkDuration = (lesson: VerifiableLesson): Finding[] => {
  const spokenMinutes = words(lesson.script) / WORDS_PER_MINUTE;
  const claimed = lesson.estimatedMinutes;
  const ratio = Math.abs(spokenMinutes - claimed) / Math.max(claimed, 1);
  if (ratio <= DURATION_TOLERANCE) return [];
  return [
    {
      category: 'duration_estimate',
      severity: 'medium',
      targetId: lesson.id,
      finding:
        `The script runs about ${spokenMinutes.toFixed(1)} minutes at ${WORDS_PER_MINUTE} words ` +
        `per minute, but the lesson claims ${claimed}.`,
      suggestedRepair: 'Correct the estimate, or lengthen or shorten the script to match.',
    },
  ];
};

const checkTranscript = (lesson: VerifiableLesson): Finding[] =>
  normalise(lesson.transcript) === normalise(lesson.script)
    ? []
    : [
        {
          category: 'spoken_clarity',
          severity: 'high',
          targetId: lesson.id,
          finding: 'The transcript does not match the script that will be spoken.',
          suggestedRepair: 'Regenerate the transcript from the final script.',
        },
      ];

const checkCoverage = (lesson: VerifiableLesson, context: VerificationContext): Finding[] => {
  const findings: Finding[] = [];
  const assessed = new Set(lesson.questions.map((q) => q.objectiveId));

  for (const objectiveId of context.plannedObjectiveIds) {
    if (!lesson.objectiveIds.includes(objectiveId)) {
      findings.push({
        category: 'objective_coverage',
        severity: 'critical',
        targetId: lesson.id,
        finding: `The plan assigns objective "${objectiveId}" to this lesson, which omits it.`,
      });
      continue;
    }
    if (!assessed.has(objectiveId)) {
      findings.push({
        category: 'objective_coverage',
        severity: 'critical',
        targetId: lesson.id,
        finding: `Objective "${objectiveId}" is taught but never assessed in this lesson.`,
        suggestedRepair: 'Add at least one item testing this objective.',
      });
    }
  }

  return findings;
};

const SUGGESTED_STRUCTURE_REPAIRS: Readonly<Record<StructureElement, string>> = {
  concrete_opening:
    'Rewrite the opening to start with a concrete situation, question or problem the learner recognises.',
  single_idea_per_segment:
    'Split the script into complete-sentence segments that each teach one idea; remove list markers.',
  worked_example:
    'Work a problem step by step inside the script, or quote a declared example in full.',
  checkpoint:
    'Add a pause prompt whose question is asked verbatim in the script, and require a response before continuing.',
};

/**
 * A lesson script missing any of the four structural elements — concrete opening, one idea per
 * segment, worked example, checkpoint question — is a critical `script_structure` finding: the
 * element is repaired (≤ 2 attempts) or the lesson is excluded, never published (FR-007, E24
 * US1). Consumes the same detectors as the evaluation scorer, so verification and scoring can
 * never disagree about what "human-sounding" means.
 */
export const checkLessonStructure = (lesson: VerifiableLesson): Finding[] => {
  const checks = checkStructuralElements({
    script: lesson.script,
    examples: lesson.examples,
    pausePrompts: lesson.pausePrompts,
  });

  return checks
    .filter((check) => !check.passes)
    .map((check) => {
      const element = check.element as StructureElement;
      return {
        category: 'script_structure',
        severity: 'critical' as const,
        targetId: lesson.id,
        finding: `Day ${lesson.day} script is missing ${STRUCTURE_ELEMENT_LABELS[element]}: ${check.detail ?? ''}`,
        suggestedRepair: SUGGESTED_STRUCTURE_REPAIRS[element],
      };
    });
};

/**
 * Run every structural check, plus interpret any independent solutions supplied.
 */
export const verifyLesson = (lesson: VerifiableLesson, context: VerificationContext): Finding[] => {
  const findings: Finding[] = [
    ...checkLessonStructure(lesson),
    ...checkCoverage(lesson, context),
    ...checkDuration(lesson),
    ...checkTranscript(lesson),
    ...checkGlossary(lesson, context),
  ];

  for (const question of lesson.questions) {
    const leakage = detectLeakage(question);
    if (leakage) findings.push(leakage);
    findings.push(
      ...checkDistractors(question),
      ...checkRubricTolerance(question),
      ...checkDifficulty(question, context),
      ...checkSourceSupport(question, context),
    );
  }

  for (const solution of context.independentSolutions ?? []) {
    if (solution.agrees) continue;
    findings.push({
      category: 'independent_solution',
      severity: 'critical',
      targetId: solution.questionId,
      finding:
        'An independent solve disagreed with the published answer. ' +
        `The verifier reached: "${solution.answer}".`,
      suggestedRepair: 'Re-derive the answer, or correct the item.',
    });
  }

  for (const signal of context.injectionSignals ?? []) {
    findings.push({
      category: 'prompt_injection',
      severity: 'high',
      targetId: lesson.id,
      finding:
        `Source chunk ${signal.chunkId} contains instruction-like text, which was treated as ` +
        `evidence and not followed: "${signal.excerpt}"`,
    });
  }

  return findings;
};

export const blocksPublication = (findings: readonly Finding[]): boolean =>
  findings.some((f) => f.severity === 'critical');

/**
 * A verifier must not be the generator. This is enforced at the call site rather than by
 * convention, because "the model checked its own work" is the failure mode the whole stage
 * exists to prevent.
 */
export const assertIndependentVerifier = (params: {
  generatorPromptHash: string;
  verifierPromptHash: string;
}): void => {
  if (params.generatorPromptHash === params.verifierPromptHash) {
    throw new DomainError(
      'forbidden',
      'The verifier prompt is identical to the generator prompt; a verifier cannot approve its ' +
        'own output.',
      { promptHash: params.generatorPromptHash },
    );
  }
};

/* --------------------------------------------------------------------- repair loop */

export const MAX_REPAIR_ATTEMPTS = 2;

export type RepairDecision =
  | { action: 'publish' }
  | { action: 'repair'; attempt: number; findings: readonly Finding[] }
  /** Coverage survives without this artefact, so drop it and carry on. */
  | { action: 'exclude'; reason: string }
  /** Coverage does not survive: publish what passed and mark the run partial. */
  | { action: 'partial'; reason: string };

export interface RepairContext {
  readonly attemptsSoFar: number;
  /** True when the curriculum still assesses every required objective without this artefact. */
  readonly coverageSurvivesWithout: boolean;
}

export const decideRepair = (
  findings: readonly Finding[],
  context: RepairContext,
): RepairDecision => {
  if (!blocksPublication(findings)) return { action: 'publish' };

  if (context.attemptsSoFar < MAX_REPAIR_ATTEMPTS) {
    return {
      action: 'repair',
      attempt: context.attemptsSoFar + 1,
      findings: findings.filter((f) => f.severity === 'critical' || f.severity === 'high'),
    };
  }

  const reason =
    `${findings.filter((f) => f.severity === 'critical').length} critical finding(s) survived ` +
    `${MAX_REPAIR_ATTEMPTS} repair attempts.`;

  return context.coverageSurvivesWithout
    ? { action: 'exclude', reason }
    : { action: 'partial', reason };
};
