# C-04 Plan attempt record

**Serves**: US3 (FR-012/FR-014: measured hit rate + per-invariant breakdown). **Status**:
output-shape change to the `plan_curriculum` generation step.

## Purpose

The plan step must record, for every planner call in a run, which invariants were violated, so
the hit-rate diagnosis names the weakest invariant and "first-attempt valid" is measurable.

## Shape

`apps/worker/src/pipeline/compile.ts`:

```ts
export interface PlanAttempt {
  readonly attempt: number;            // 1-based planner call
  readonly violations: readonly string[]; // violation messages from findPlanViolations
  readonly passed: boolean;
}
export interface PlanCurriculumResult {
  readonly plan: CurriculumPlan;
  readonly attempts: readonly PlanAttempt[];
}
```

- `planCurriculum(...)` returns `PlanCurriculumResult`; the `plan_curriculum` step output is the
  result object; `compileGap` stores `result.plan` in the curriculum and hands `result.attempts`
  nowhere else (the step log is the record).
- `PIPELINE_VERSION` bumps `'1.0.0' → '1.1.0'` so new runs record the new shape; the harness
  reads it defensively (a step output that is a bare plan — old shape — counts as one attempt
  with no recorded violations, for backward-compatible resume reads).
- Idempotency is preserved: `runStep` reuses the succeeded step by key
  (`decideStep`, `packages/domain/src/generation/state-machine.ts`); attempts are append-only
  within one run.

## Validation

- `tests/evaluation/plan-hit-rate.test.ts`: compiles `eval_01` through the real pipeline (fake
  provider), reads the `plan_curriculum` step via `uow.generation.getStep`/`listSteps`, asserts
  `attempts.length ≥ 1`, `attempts[0].passed === true` on the reference pack, and prints the
  per-invariant breakdown (count of violations per `code` across attempts).
- `scripts/measure-plan-hit-rate.ts`: CLI runner (fake: `eval_01`; live: all fixtures) printing
  `first-attempt valid X/Y (Z%)` + per-invariant table; result recorded as evidence in
  `tasks/status.json` (FR-022, SC-008).
