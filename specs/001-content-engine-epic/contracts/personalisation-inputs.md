# C-06 Personalization inputs

**Serves**: US4 (FR-016–FR-020; constitution §1). **Status**: new domain module + compile
threading.

## Purpose

`curriculum = f(gap, sources, diagnostic, learner profile, mastery evidence)` — the planner
receives all five inputs, and the plan is deterministically adapted so differing inputs yield
measurably different curricula without weakening idempotency or the validation gate.

## Shape

`packages/domain/src/curriculum/personalisation.ts` (new, pure):

```ts
export interface LearnerProfileInput {
  readonly goals: readonly string[];
  readonly preferredLessonLength: 'short' | 'standard' | 'long';
}
export interface MasteryInput {
  readonly satisfied: readonly string[];          // strong + recent → at most Day-1 recall
  readonly decayed: readonly string[];            // stale → re-demonstrate, never assumed
  readonly reviewDue: readonly string[];          // FR-020: schedule for review
  readonly evidenceSummary: string;               // rendered into the learner brief
}
export interface PlanInputs {
  readonly gap: { readonly rawStatement: string; readonly dailyMinutes: number; readonly deadline?: string };
  readonly diagnostic: DiagnosticInterpretation;
  readonly profile: LearnerProfileInput;
  readonly mastery: MasteryInput;
}
export const derivePlanInputs = (deps: {
  normalisation: GapNormalisation;
  diagnostic: DiagnosticInterpretation;
  profile: LearnerProfileInput;
  mastery: MasteryInput;
}): { learnerBriefParts: string[]; satisfiedExternalPrerequisites: string[] };

export const personalisePlan = (plan: CurriculumPlan, inputs: PlanInputs): CurriculumPlan;
```

`personalisePlan` adjustments (each preserves the invariants; output is re-run through
`findPlanViolations` before storage):
- satisfied prerequisites → replace any full teaching activity on them with a `review` activity
  of ≤ 5 minutes on Day 1 (FR-018 "at most a brief recall check");
- decayed capabilities → ensure a re-demonstration `retrieval`/`application` activity is
  scheduled (FR-018/FR-020);
- `preferredLessonLength` → rescale activity durations within `plan.dailyMinutes` (short: more
  smaller sessions per day kept under budget; long: fewer, deeper activities) (FR-019);
- `diagnostic.recommendedStartingDifficulty` → shift Day-1 blueprint target difficulty within
  [1, 5] without breaking the non-decreasing progression (FR-019);
- `goals` → reflected in the learner brief so the planner sequences toward them (FR-019).

## Validation

- Unit tests (`packages/domain/src/curriculum/personalisation.test.ts`): two learners differing
  in only one of (diagnostic, profile, mastery) get measurably different plans (objectives,
  sequencing, pacing or starting difficulty — SC-004); satisfied prereq → at most a recall
  check; decayed → re-demonstration scheduled; `findPlanViolations(adapted)` is empty in every
  case (FR-013).
- Pipeline test (`tests/evaluation/differentiation.test.ts`, fake provider): same gap + same
  sources, two profiles → stored curricula differ; reuse test on `eval_10_prior_mastery`
  (prior mastery fixture) asserts no full reteaching (FR-018).
- Live gate (`tests/evaluation/live-provider.test.ts`) keeps the full-pack score with the new
  brief (SC-005).
