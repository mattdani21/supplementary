# Quickstart: validating Content Engine Quality (E24)

**Phase 1 output of `/speckit-plan`** | Branch `001-content-engine-epic` | 2026-08-14

This is a run/validation guide, not implementation detail (implementation lives in `tasks.md`).
Every scenario is runnable and produces the evidence the spec demands (FR-022, SC-008).

## Prerequisites

- `pnpm install` from a fresh checkout (AGENTS.md §7).
- Local Postgres for the integration paths that need it: `pnpm local:up`, then `pnpm db:migrate`
  (a new forward-only migration `006_learner_profile.sql` must be applied).
- Live evaluation requires the human approval gate: `GAPOS_PROVIDER_MODE=live` +
  `GAPOS_LLM_API_KEY` (AGENTS.md §5). All scenarios marked **(live)** are skipped loudly without
  them (`tests/evaluation/live-provider.test.ts` pattern).

## Scenario 1 — The quality gate passes with the new dimension (US1 + US5)

```bash
pnpm verify
```

Expected: format + lint + typecheck + full suite green, including the extended evaluation gate
(`tests/evaluation/reference-pack.test.ts`) which now asserts the `human_sounding` floor on the
`eval_01` reference curriculum and runs the four degradation cases (meta-opening, list-like
prose, no worked example, no checkpoint) — each proves a model-dump script scores below the
floor with the failing element named (SC-002, FR-005/FR-006).

## Scenario 2 — First-attempt valid-plan rate (US3)

```bash
pnpm exec vitest run tests/evaluation/plan-hit-rate.test.ts          # fake: eval_01, 100%
pnpm exec tsx scripts/measure-plan-hit-rate.ts                        # fake: eval_01
GAPOS_PROVIDER_MODE=live pnpm exec tsx scripts/measure-plan-hit-rate.ts   # (live) all ten fixtures
```

Expected: the harness prints `first-attempt valid X/Y (Z%)` and a per-invariant table (count per
violation `code` across all recorded attempts) read from the `plan_curriculum` step output
(`{ plan, attempts }`, C-04). The live run must reach ≥ 80% (SC-001); the guard test
(`tests/evaluation/plan-gate-guard.test.ts`) proves every known-bad plan shape is still rejected
with all violations returned together (FR-013/FR-015).

## Scenario 3 — Traceability invariants (US2)

```bash
pnpm exec vitest run tests/evaluation/traceability.test.ts
pnpm exec vitest run apps/web/src/components/screens.test.tsx   # source-link affordance
```

Expected: 100% of published objectives/lessons/questions on the reference pack carry a locator
or an explicit general-knowledge label, and every source-grounded locator resolves to a real
evidence chunk (FR-008, SC-003). The study page renders locator links next to the lesson and
each question, one step from the Sources tab chunk (FR-011, SC-006). The claim-audit path
(`audit_claims` step, C-05) records a resolution for every unsupported claim before publication
(FR-009) and refuses items citing injected chunks (FR-010).

## Scenario 4 — Differentiation and reuse (US4)

```bash
pnpm exec vitest run packages/domain/src/curriculum/personalisation.test.ts
pnpm exec vitest run tests/evaluation/differentiation.test.ts
```

Expected: two learners with the same gap and sources but different diagnostics, profiles or
mastery evidence receive measurably different curricula (SC-004); a mastered prerequisite is at
most a Day-1 recall check, a decayed one is re-demonstrated (FR-018); the adapted plan still
passes `findPlanViolations` (FR-013).

## Scenario 5 — Regression protection (US5)

```bash
pnpm exec tsx scripts/record-eval-baselines.ts     # deliberate, review-gated baseline update
git diff tasks/evaluation-baselines.json
```

Expected: `tasks/evaluation-baselines.json` gains the `human_sounding` dimension per fixture;
the baseline update is an intentional, evidence-backed change (spec Assumptions: "baseline
updates follow the existing deliberate flow"), never silent. The live gate then fails any run
that slips more than `REGRESSION_TOLERANCE` below a baseline and names the dimension
(FR-021, SC-005). Reproduce any claimed improvement by re-running the exact command recorded in
`tasks/status.json` (SC-008).

## Contract and schema refresh

```bash
pnpm specs:generate        # after any ai-contracts change; committed, byte-for-byte asserted
pnpm db:migrate            # applies 006_learner_profile.sql; forward-only, idempotent
```

See [contracts/](contracts/README.md) for the seven contracts (C-01…C-07) and
[data-model.md](data-model.md) for entity deltas.
