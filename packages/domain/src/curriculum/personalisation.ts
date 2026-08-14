/**
 * Personalisation (E24 US4, C-06, FR-016…FR-020).
 *
 * The curriculum is a deterministic function of gap + sources + diagnostic + learner profile +
 * mastery evidence (constitution §1): `personalisePlan` adapts the planner's output so differing
 * inputs yield measurably different curricula, and `derivePlanInputs` renders the five inputs
 * into the learner brief the planner sees.
 *
 * The module is pure — values in, an adapted plan out. It never talks to a provider or a store,
 * and it never weakens the validation gate: the pipeline re-runs `findPlanViolations` on the
 * adapted plan before storing it (FR-013), so adaptation can never ship an invalid plan.
 *
 * Adaptation rules (each preserves the plan invariants):
 *   - satisfied prerequisites → at most a 5-minute recall check on the first teaching day, and
 *     the objective is never retaught on later days (FR-018);
 *   - decayed capabilities → the lesson becomes a re-demonstration retrieval/application
 *     activity, never assumed (FR-018/FR-020);
 *   - preferredLessonLength → rescale activity durations within the daily budget (short: more
 *     smaller sessions; long: fewer deeper ones) (FR-019);
 *   - diagnostic.recommendedStartingDifficulty → shift the Day-1 blueprint target difficulty
 *     within [1, 5] without breaking the non-decreasing progression (FR-019);
 *   - goals → rendered into the learner brief so the planner sequences toward them (FR-019).
 */

import type {
  CurriculumPlan,
  DayPlan,
  DiagnosticInterpretation,
  GapNormalisation,
} from '@gapos/ai-contracts';

export type PreferredLessonLength = 'short' | 'standard' | 'long';

/** The learner's profile: plan-shape inputs from the user record (E24 US4, R7). */
export interface LearnerProfileInput {
  readonly goals: readonly string[];
  readonly preferredLessonLength: PreferredLessonLength;
}

/** What the learner's mastery evidence says about prior capabilities (FR-018/FR-020). */
export interface MasteryInput {
  /** Strong + recent → at most a Day-1 recall check, never retaught. */
  readonly satisfied: readonly string[];
  /** Stale → re-demonstrated, never assumed. */
  readonly decayed: readonly string[];
  /** FR-020: scheduled for review inside the new curriculum. */
  readonly reviewDue: readonly string[];
  /** Rendered into the learner brief. */
  readonly evidenceSummary: string;
}

/** All five personalization inputs the curriculum is a function of. */
export interface PlanInputs {
  readonly gap: {
    readonly rawStatement: string;
    readonly dailyMinutes: number;
    readonly deadline?: string;
  };
  readonly diagnostic: DiagnosticInterpretation;
  readonly profile: LearnerProfileInput;
  readonly mastery: MasteryInput;
}

const normalise = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Render the profile and mastery inputs into learner-brief parts and the held-prerequisites
 * list. The pipeline combines these with the normalisation/diagnostic brief and hands them to
 * the planner, so all five inputs reach it (FR-016).
 */
export const derivePlanInputs = (deps: {
  normalisation: GapNormalisation;
  diagnostic: DiagnosticInterpretation;
  profile: LearnerProfileInput;
  mastery: MasteryInput;
}): { learnerBriefParts: string[]; satisfiedExternalPrerequisites: string[] } => {
  const { normalisation, diagnostic, profile, mastery } = deps;
  const parts: string[] = [
    `The learner's profile: preferred lesson length ${profile.preferredLessonLength}.`,
    ...(profile.goals.length > 0
      ? [`The learner's stated goals: ${profile.goals.join('; ')}. Sequence the plan toward them.`]
      : []),
    ...(mastery.satisfied.length > 0
      ? [
          `The learner has previously mastered and still holds: ${mastery.satisfied.join(
            ', ',
          )}. Treat these as held — do not reteach them; at most a brief recall check on Day 1.`,
        ]
      : []),
    ...(mastery.decayed.length > 0
      ? [
          `The learner previously mastered but has decayed: ${mastery.decayed.join(
            ', ',
          )}. Re-demonstrate these, never assume them.`,
        ]
      : []),
    ...(mastery.reviewDue.length > 0
      ? [`Due for review: ${mastery.reviewDue.join(', ')}. Schedule review.`]
      : []),
    ...(mastery.evidenceSummary.length > 0
      ? [`Mastery evidence: ${mastery.evidenceSummary}.`]
      : []),
  ];
  return {
    learnerBriefParts: parts,
    satisfiedExternalPrerequisites: [
      ...normalisation.assumedPrerequisites,
      ...diagnostic.demonstratedCapabilities,
      ...mastery.satisfied,
    ],
  };
};

const clonePlan = (plan: CurriculumPlan): CurriculumPlan => ({
  ...plan,
  objectives: plan.objectives.map((o) => ({
    ...o,
    prerequisiteObjectiveIds: [...o.prerequisiteObjectiveIds],
    externalPrerequisites: [...o.externalPrerequisites],
    evidence: { ...o.evidence, locators: [...o.evidence.locators] },
  })),
  days: plan.days.map((d) => ({
    ...d,
    objectiveIds: [...d.objectiveIds],
    activities: d.activities.map((a) => ({ ...a })),
  })),
  glossary: plan.glossary.map((g) => ({ ...g })),
  exclusions: [...plan.exclusions],
  assessmentBlueprint: plan.assessmentBlueprint.map((e) => ({ ...e })),
});

/** Trim the largest activities until the day fits the learner's budget (never below 1 minute). */
const trimToBudget = (day: DayPlan, budget: number): void => {
  const over = (): number =>
    day.activities.reduce((sum, a) => sum + a.estimatedMinutes, 0) - budget;
  while (over() > 0) {
    const largest = [...day.activities].sort((a, b) => b.estimatedMinutes - a.estimatedMinutes)[0]!;
    const excess = over();
    const cut = Math.min(excess, largest.estimatedMinutes - 1);
    if (cut <= 0) break;
    largest.estimatedMinutes -= cut;
  }
};

/**
 * Deterministically adapt the planner's plan to the five inputs. The output is re-validated by
 * `findPlanViolations` before storage, so every rule here may assume the input plan was valid
 * but must not rely on it staying valid after adaptation.
 */
export const personalisePlan = (plan: CurriculumPlan, inputs: PlanInputs): CurriculumPlan => {
  const adapted = clonePlan(plan);
  const satisfied = new Set(inputs.mastery.satisfied.map(normalise));
  const decayed = new Set(inputs.mastery.decayed.map(normalise));

  /* A. satisfied prerequisites → recall check, never retaught (FR-018) */
  for (const objective of adapted.objectives) {
    if (!satisfied.has(normalise(objective.capabilityStatement))) continue;
    const teachingDays = adapted.days.filter((d) => d.objectiveIds.includes(objective.id));
    if (teachingDays.length === 0) continue;
    const first = teachingDays[0]!;
    for (const day of teachingDays.slice(1)) {
      day.objectiveIds = day.objectiveIds.filter((id) => id !== objective.id);
    }
    const audio = first.activities.find((a) => a.kind === 'audio_lesson');
    if (audio) {
      first.activities = first.activities.map((a) =>
        a === audio
          ? {
              kind: 'review',
              description: `Recall check: ${objective.capabilityStatement}`,
              estimatedMinutes: Math.min(5, audio.estimatedMinutes),
            }
          : a,
      );
    } else {
      first.activities = [
        ...first.activities,
        {
          kind: 'review',
          description: `Recall check: ${objective.capabilityStatement}`,
          estimatedMinutes: 5,
        },
      ];
      trimToBudget(first, plan.dailyMinutes);
    }
  }

  /* B. decayed capabilities → re-demonstration, never assumed (FR-018/FR-020) */
  for (const objective of adapted.objectives) {
    if (!decayed.has(normalise(objective.capabilityStatement))) continue;
    const first = adapted.days.find((d) => d.objectiveIds.includes(objective.id));
    if (!first) continue;
    const audio = first.activities.find((a) => a.kind === 'audio_lesson');
    if (audio) {
      first.activities = first.activities.map((a) =>
        a === audio
          ? {
              kind: 'retrieval',
              description: `Re-demonstrate: ${objective.capabilityStatement}`,
              estimatedMinutes: audio.estimatedMinutes,
            }
          : a,
      );
    } else {
      first.activities = [
        ...first.activities,
        {
          kind: 'retrieval',
          description: `Re-demonstrate: ${objective.capabilityStatement}`,
          estimatedMinutes: 5,
        },
      ];
      trimToBudget(first, plan.dailyMinutes);
    }
  }

  /* C. preferred lesson length → rescale durations within the daily budget (FR-019) */
  const scale =
    inputs.profile.preferredLessonLength === 'short'
      ? 0.75
      : inputs.profile.preferredLessonLength === 'long'
        ? 1.25
        : 1;
  if (scale !== 1) {
    for (const day of adapted.days) {
      day.activities = day.activities.map((a) => ({
        ...a,
        estimatedMinutes: Math.max(5, Math.round(a.estimatedMinutes * scale)),
      }));
      trimToBudget(day, plan.dailyMinutes);
    }
  }

  /* D. diagnostic start difficulty → shift the Day-1 blueprint level (FR-019) */
  const start = Math.min(5, Math.max(1, inputs.diagnostic.recommendedStartingDifficulty));
  const day1Ids = new Set(adapted.days[0]?.objectiveIds ?? []);
  const laterLevels = adapted.days
    .slice(1)
    .flatMap((d) => d.objectiveIds)
    .map((id) => adapted.assessmentBlueprint.find((e) => e.objectiveId === id)?.targetDifficulty)
    .filter((v): v is number => v !== undefined);
  // Day 1 may rise to the diagnostic's recommendation, but never above where later days start —
  // that is what keeps the difficulty progression non-decreasing.
  const laterMin = laterLevels.length > 0 ? Math.min(...laterLevels) : start;
  const day1Target = Math.min(start, laterMin);
  if (day1Target > 1) {
    for (const entry of adapted.assessmentBlueprint) {
      if (day1Ids.has(entry.objectiveId)) {
        entry.targetDifficulty = Math.max(entry.targetDifficulty, day1Target);
      }
    }
  }

  return adapted;
};
