# Contracts: Content Engine Quality (E24)

**Phase 1 output of `/speckit-plan`** | Branch `001-content-engine-epic` | 2026-08-14

Interface contracts this epic introduces or changes, mapped to the user stories they serve.
Each contract names its owner files, shape, validation and the test that locks it. Published
model-facing contracts are zod schemas in `packages/ai-contracts` and are regenerated into
`specs/generation-schemas/` with `pnpm specs:generate` (asserted byte-for-byte by
`tests/architecture/specs.test.ts`).

| Contract | File | Serves | Status |
|---|---|---|---|
| [C-01 Evaluation dimension](#c-01-evaluation-dimension-human_sounding) | `contracts/evaluation-rubric.md` | US1, US5 | new |
| [C-02 Human-sounding rubric](#c-02-human-sounding-rubric) | `contracts/evaluation-rubric.md` | US1, US5 | new |
| [C-03 Lesson structure verification](#c-03-lesson-structure-verification) | `contracts/lesson-structure-verification.md` | US1 | new category |
| [C-04 Plan attempt record](#c-04-plan-attempt-record) | `contracts/plan-attempt-record.md` | US3 | output-shape change |
| [C-05 Claim audit](#c-05-claim-audit) | `contracts/claim-audit.md` | US2 | new model contract |
| [C-06 Personalization inputs](#c-06-personalization-inputs) | `contracts/personalisation-inputs.md` | US4 | new |
| [C-07 Source-link affordance](#c-07-source-link-affordance) | `contracts/source-links.md` | US2 | new user-facing surface |
