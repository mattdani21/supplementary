# Implementation Plan: Content Engine Quality (E24)

**Branch**: `001-content-engine-epic` | **Date**: 2026-08-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-content-engine-epic/spec.md`

**Note**: This file is the `/speckit-plan` output. Phase 0 research: [research.md](research.md).
Phase 1 design: [data-model.md](data-model.md), [contracts/](contracts/README.md),
[quickstart.md](quickstart.md). Phase 2 execution tasks: [tasks.md](tasks.md) (`/speckit-tasks`).

## Summary

E24 makes user-specific curriculum quality the moat: (1) lesson scripts must read like a human
teacher — scored by a new deterministic `human_sounding` rubric dimension in the evaluation pack
and verified by a new `script_structure` gate in the domain verifier before publication (US1);
(2) every objective, lesson and question traces to a real source locator or is explicitly
labelled general knowledge, unsupported claims get a recorded resolution via a new
`claim_audit` step, and locators become user-visible one step from the source (US2); (3) the
planner's first-attempt valid-plan rate is measured by a harness reading the recorded
`{ plan, attempts }` step output and raised to ≥ 80% on the reference packs without weakening
`findPlanViolations` (US3); (4) the curriculum becomes a deterministic function of gap + sources
+ diagnostic + learner profile + mastery evidence via a new pure `personalisePlan` module (US4);
(5) the regression gate absorbs the new dimension, records baselines and fails on any slip
beyond tolerance (US5). All changes are additive; no existing floor, invariant, contract or
migration is weakened (FR-021), and the vertical slice keeps working (constitution §5).

## Technical Context

**Language/Version**: TypeScript 5.7 (`strict`, no `any` in production), Node ≥ 22, ESM
(`"type": "module"`), pnpm 10 workspace monorepo.

**Primary Dependencies**: `zod` (contracts, `packages/ai-contracts`), `vitest` (test runner),
existing workspace packages (`@gapos/domain`, `@gapos/evaluation`, `@gapos/ai-contracts`,
`@gapos/database`, `@gapos/provider-adapters`, `@gapos/test-fixtures`, `@gapos/observability`).
No new runtime dependency is required; the rubric and personalisation logic are pure
TypeScript.

**Storage**: PostgreSQL via `packages/database` (forward-only migrations in
`packages/database/src/migrations/`). One new migration: `006_learner_profile.sql` (adds
`preferred_lesson_length` and `goals` to `users`, R7). Plan-attempt recording uses the existing
`generation_step.output` JSONB (no migration). `tasks/evaluation-baselines.json` stores the
evaluation baselines.

**Testing**: `vitest` (`pnpm test`), full gate `pnpm verify` (format + lint + typecheck +
test). Evaluation gates live in `tests/evaluation/` (`reference-pack.test.ts` fake gate,
`live-provider.test.ts` live gate), unit tests co-located (`packages/domain/**/*.test.ts`,
`packages/ai-contracts/**/*.test.ts`, `packages/evaluation`), component tests in
`apps/web/src/components/*.test.tsx`, end-to-end in `tests/end-to-end/`. Every step is
test-first (write the failing test, then implement).

**Target Platform**: Node worker (`apps/worker`) + Next.js web (`apps/web`); the evaluation
gate runs in CI on every verification (US5).

**Project Type**: Monorepo (packages + apps): web service (Next.js) + durable worker +
evaluation harness.

**Performance Goals**: Latency budget unchanged (docs/ARCHITECTURE.md §94): Day 1 usable < 3
minutes, full course < 10 minutes at p90 on the reference workload (SC-007). The new rubric is
deterministic O(script length); the claim audit adds one budgeted model call per lesson inside
the existing `auditing` stage, keyed idempotently by `hash(lesson)`.

**Constraints**:
- The validation gate (`findPlanViolations`, `packages/domain/src/curriculum/plan-validation.ts`)
  never weakens; the guard test proves every known-bad shape is still rejected (FR-013/FR-015).
- Domain stays pure (no web/persistence/provider imports) — rubric detectors and
  `personalisePlan` are pure functions; provider output is schema-validated before persistence
  (new `claim_audit` contract); generation stays idempotent (step-keyed, `PIPELINE_VERSION`
  bump to `1.1.0`); migrations forward-only; source text is evidence, never instruction
  (injection scan already in `compileGap`, extended to refuse items citing injected chunks).
- Cost is a design input: deterministic scoring, one budgeted audit call per lesson, no
  double-charge on retries (constitution §7).

**Scale/Scope**: 10 evaluation fixtures (`packages/evaluation/src/fixtures/index.ts`), up to
7-day curricula, one learner per account, per-user data isolation preserved (constitution §8).
Scope boundary per spec Assumptions: the only new user-facing surface is the source-link
affordance; no product-scope, slice or architecture change.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Constitution principle | Verdict | How the plan satisfies it |
|---|---|---|
| §1 Personal fabrication is the product | PASS | US4 makes the curriculum a function of all five inputs (`personalisePlan` + five-input brief); no two learners with differing inputs get the same curriculum (FR-016/FR-017) |
| §2 Quality is a contract, not a vibe | PASS | The human-sounding rubric is a published, floor-enforced, degradation-tested contract (FR-005/FR-006, SC-002); source links follow quality.md §2 states |
| §3 Content is the moat | PASS | Rubric-scored scripts (US1), traceability invariants + audit (US2), hit rate raised without weakening the gate (US3) |
| §4 Evidence over assertion | PASS | Hit-rate harness, degradation suite, baseline comparisons, recorded commands in `tasks/status.json` (FR-022, SC-008) |
| §5 The slice must keep working | PASS | All changes are additive to `compileGap`; the fake-provider vertical slice stays green on every verify |
| §6 Architecture rules are enforced | PASS | Rubric detectors + `personalisePlan` are pure domain/evaluation code; `claim_audit` output is schema-validated before persistence; step idempotency preserved; no SQL writes status; migrations forward-only |
| §7 Cost is a design input | PASS | Deterministic scoring; one idempotent audit call per lesson; retries never double-charge |
| §8 Learner's data belongs to the learner | PASS | Profile and mastery evidence are read per-owner only and never cross-learner |
| §9 Steer from real use | PASS | Reference packs are the real-use proxy; the gate runs on every verification and notices slips |

**Gate result: PASS — no violations.** Phase 1 design re-check: the design introduces no new
architecture (no new packages, no direct provider calls, no status-writing paths), so the
verdict is unchanged. `Complexity Tracking` below is therefore empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-content-engine-epic/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output: decisions R1–R10, resolved unknowns
├── data-model.md        # Phase 1 output: entity deltas, relationships, validation
├── quickstart.md        # Phase 1 output: runnable validation guide
├── contracts/           # Phase 1 output: C-01…C-07 interface contracts
│   ├── README.md
│   ├── evaluation-rubric.md
│   ├── lesson-structure-verification.md
│   ├── plan-attempt-record.md
│   ├── claim-audit.md
│   ├── personalisation-inputs.md
│   └── source-links.md
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```text
packages/
├── ai-contracts/
│   └── src/
│       ├── contracts.ts            # +ClaimAuditContract, VERIFICATION_CATEGORIES += script_structure
│       ├── versioning.ts           # CONTRACT_NAMES += claim_audit
│       └── contracts.test.ts       # contract tests for the new/changed schemas
├── domain/
│   └── src/
│       ├── curriculum/
│       │   ├── plan-validation.ts  # unchanged (gate); consumed by harness + guard test
│       │   ├── script-structure.ts # NEW: the four element detectors (single source of truth)
│       │   ├── personalisation.ts  # NEW: derivePlanInputs + personalisePlan (pure)
│       │   └── personalisation.test.ts
│       ├── verification/
│       │   ├── verifier.ts         # +checkLessonStructure (script_structure), injection-chunk refusal
│       │   └── verifier.test.ts    # structural + injection findings
│       └── generation/
│           └── state-machine.ts    # GENERATION_STEPS += 'audit_claims'
├── evaluation/
│   └── src/
│       ├── fixture.ts              # SCORE_DIMENSIONS/SCORE_FLOORS += human_sounding
│       ├── scorer.ts               # +scoreHumanSounding (imports detectors from @gapos/domain)
│       ├── traceability.ts         # NEW: assertTraceability(plan, lessons, evidence)
│       ├── HUMAN_SOUNDING_RUBRIC.md# NEW: published rubric + floor + calibration
│       └── fixtures/index.ts       # unchanged (eval_01 is the fake-scoreable fixture)
├── database/
│   └── src/
│       ├── migrations/006_learner_profile.sql   # NEW: users.preferred_lesson_length, users.goals
│       └── repositories/           # types.ts (User fields), memory.ts, postgres.ts
└── test-fixtures/
    └── src/
        ├── reference-curriculum.ts # unchanged fixtures (pausePrompts/examples feed the rubric)
        └── faulty-fixtures.ts      # +scripted claim_audit + faulty lesson (missing checkpoint)

apps/
└── worker/src/pipeline/
    ├── compile.ts                  # planCurriculum → {plan, attempts}; PIPELINE_VERSION 1.1.0;
    │                               #   claim audit step in auditing; profile+mastery brief;
    │                               #   personalisePlan applied pre-store; generateLesson
    │                               #   instruction demands the four elements
    └── step-runner.ts              # unchanged

apps/web/
└── src/
    ├── components/
    │   ├── source-links.tsx        # NEW: locator links + general-knowledge label (a11y)
    │   ├── attempt-form.tsx        # render question locators pre-answer
    │   └── audio-player.tsx        # checkpoint: pause at pausePrompt, require response
    └── app/gaps/[gapId]/
        ├── study/page.tsx          # Listen-section locator links + checkpoint surface
        └── page.tsx                # Sources tab: id="chunk-{chunkId}" anchors

tests/
├── evaluation/
│   ├── reference-pack.test.ts      # +human_sounding floor + 4 degradation cases
│   ├── plan-hit-rate.test.ts       # NEW: first-attempt rate + per-invariant breakdown
│   ├── plan-gate-guard.test.ts     # NEW: gate rejects every known-bad shape
│   ├── traceability.test.ts        # NEW: 100% locator/general-knowledge invariant
│   ├── differentiation.test.ts     # NEW: differing inputs → differing curricula
│   └── live-provider.test.ts       # +human_sounding floor + no regression (live gate)
└── end-to-end/
    └── compile-math-gap.test.ts    # +missing-element lesson is repaired/excluded, never shipped

scripts/
└── measure-plan-hit-rate.ts        # NEW: CLI runner (fake eval_01; live all fixtures)
```

**Structure Decision**: the existing monorepo layout is preserved, and every new module lands in
the package that owns the concern. The four human-sounding element detectors are the single
source of truth in `packages/domain/src/curriculum/script-structure.ts` (exported from
`packages/domain/src/index.ts`), because `@gapos/evaluation` already depends on
`@gapos/domain` and the reverse edge would be a cycle; the evaluation scorer imports them. All
other placements: personalisation in `packages/domain/src/curriculum/personalisation.ts`;
contracts in `packages/ai-contracts`; pipeline wiring in `apps/worker/src/pipeline/compile.ts`;
user-facing surface in `apps/web`.

## Implementation Approach (test-first, per user story)

Every step below starts from a failing test. The full task checklist with IDs, file paths and
dependencies is in [tasks.md](tasks.md); this section records the order and the concrete files.

### Phase 0 — Baseline (Setup)

1. `env -u GAPOS_PROVIDER_MODE -u GAPOS_LLM_MODEL pnpm verify` on a clean tree; record the
   baseline count in `tasks/status.json` (the sandbox injects live mode; CI does not — same
   note as GAP-034/GAP-035).

### Phase 1 — Foundational

2. **Contract surface for lesson structure (C-03)**: extend `VERIFICATION_CATEGORIES`
   (`packages/ai-contracts/src/contracts.ts`) and the domain `FindingCategory`
   (`packages/domain/src/verification/verifier.ts`) with `'script_structure'`; extend
   `packages/ai-contracts/src/contracts.test.ts`; run `pnpm specs:generate` so
   `tests/architecture/specs.test.ts` passes.
3. **Plan attempt record (C-04)**: change `planCurriculum` in
   `apps/worker/src/pipeline/compile.ts` to return `{ plan, attempts }`, update the caller,
   bump `PIPELINE_VERSION` to `'1.1.0'`. Test-first in `tests/evaluation/plan-hit-rate.test.ts`
   (reads the step output via `uow.generation.listSteps`).
4. **Claim audit contract + step (C-05)**: add `ClaimAuditContract` +
   `CONTRACT_NAMES` (`packages/ai-contracts/src/contracts.ts`, `versioning.ts`), add
   `'audit_claims'` to `GENERATION_STEPS` (`packages/domain/src/generation/state-machine.ts`),
   regenerate schemas, extend `packages/ai-contracts/src/contracts.test.ts`.
5. **Traceability invariant (R9)**: add `assertTraceability` to
   `packages/evaluation/src/traceability.ts` with `tests/evaluation/traceability.test.ts`
   written first.

### Phase 2 — US1 Script quality (P1, MVP)

6. **Rubric dimension (C-01/C-02)**: write the degradation tests first in
   `tests/evaluation/reference-pack.test.ts` (meta-opening, list-like prose, no worked example,
   no checkpoint → below floor, named element); add `'human_sounding'` to `SCORE_DIMENSIONS` and
   `SCORE_FLOORS` (`packages/evaluation/src/fixture.ts`), implement the four detectors in
   `packages/domain/src/curriculum/script-structure.ts` and `scoreHumanSounding` in `scorer.ts`;
   publish `HUMAN_SOUNDING_RUBRIC.md`; calibrate the floor on the reference curricula and record
   the baseline (FR-005/FR-006, SC-002).
7. **Verification gate (FR-007)**: add `checkLessonStructure` to `verifyLesson`
   (`packages/domain/src/verification/verifier.ts`) using the shared detectors; unit tests in
   `verifier.test.ts`; pipeline test in `tests/end-to-end/compile-math-gap.test.ts` with a
   scripted faulty lesson → repaired/excluded, never published.
8. **Generation instruction**: update `generateLesson`'s instruction in `compile.ts` to demand
   the four elements (concrete opening, one idea per segment, worked example inside the script,
   checkpoint via `pausePrompts`) and update `packages/test-fixtures/src/faulty-fixtures.ts`
   for the degradation script.
9. **Checkpoint pauses the learner (US1 AS3)**: the study page renders the lesson's
   `pausePrompts` as an interactive checkpoint that pauses the audio player and requires a
   response before continuing; the response is graded like any practice answer (correct →
   confirm; incorrect → repair surface with verified answer + source link) reusing
   `practice-feedback.tsx`. Component tests in `apps/web/src/components/` (audio-player pause +
   checkpoint form) and `apps/web/src/components/screens.test.tsx`.

### Phase 3 — US2 Traceability (P1)

10. **Audit step wiring (FR-009/FR-010)**: run `claim_audit` per lesson in the `auditing` stage
    of `compileGap` (step `audit_claims`, inputVersion `hash(lesson)`), record findings with
    `repairStatus` = resolution (`repaired` / `excluded` / `accepted`); unresolved claims are
    `critical` → existing repair/exclude loop refuses publication. Fake-provider script in
    `packages/test-fixtures/src/faulty-fixtures.ts` (default: clean; faulty: unresolved claim).
11. **Injection-chunk refusal**: extend `checkSourceSupport` (verifier) so an evidence locator
    whose `chunkId` is in `context.injectionSignals` is a `critical` finding (refused/repaired);
    keep `eval_07` passing in the live gate.
12. **User-visible source links (C-07)**: `source-links.tsx` component; study page Listen +
    per-question locators; Sources-tab chunk anchors; general-knowledge label; component tests.
13. **Invariant assertion**: `tests/evaluation/traceability.test.ts` against the compiled
    reference curriculum (100% locator or labelled, locators resolve, SC-003/SC-006).

### Phase 4 — US3 Hit rate (P1)

14. **Harness + guard**: `tests/evaluation/plan-hit-rate.test.ts` (first-attempt rate +
    per-invariant breakdown from the step record) and `tests/evaluation/plan-gate-guard.test.ts`
    (every known-bad shape rejected with all violations together, FR-015); runner
    `scripts/measure-plan-hit-rate.ts`; record evidence in `tasks/status.json` (FR-022).
15. **Planner improvement**: iterate on the `planCurriculum` instruction/`learnerBrief` to reduce
    first-attempt violations (per-invariant checklist, budget arithmetic, failure-mode glossary);
    re-run the harness; target ≥ 80% on the live pack (SC-001) while the guard test stays green —
    the gate is never weakened.

### Phase 5 — US4 Personalization (P2)

16. **Profile**: migration `006_learner_profile.sql` + `User` fields + both repositories;
    `pnpm db:migrate`; repo tests.
17. **Pure adaptation (C-06)**: `packages/domain/src/curriculum/personalisation.ts`
    (`derivePlanInputs`, `personalisePlan`) with `personalisation.test.ts` first — differing
    inputs → differing plans, satisfied prereq → ≤ 5-min Day-1 recall, decayed →
    re-demonstration, adapted plan revalidated by `findPlanViolations`.
18. **Pipeline threading**: `compileGap` reads profile (`uow.users.find`) + mastery evidence
    (`uow.mastery.listEvidenceForCurriculum` + `classifyPriorCapabilities`), renders the
    five-input `learnerBrief`, applies `personalisePlan` before storing the curriculum.
19. **Differentiation + reuse tests**: `tests/evaluation/differentiation.test.ts` (same gap +
    sources, differing inputs → measurably different curricula, SC-004; `eval_10_prior_mastery`
    reuse behaviour, FR-018).

### Phase 6 — US5 Regression gate (P2)

20. **Gate + baselines**: baselines recorded via `scripts/record-eval-baselines.ts` into
    `tasks/evaluation-baselines.json` (now including `human_sounding`), with the command +
    result recorded (deliberate, review-gated flow); live gate (`live-provider.test.ts`)
    asserts the new floor and no regression beyond `REGRESSION_TOLERANCE` (FR-021, SC-005).

### Phase 7 — Polish & cross-cutting

21. Update `specs/quality.md` §10/§12 enforcement table (human-sounding row), `docs/PRODUCT.md`
    (profile fields, hit-rate measurement, audit step), `docs/ARCHITECTURE.md` (stages A–H
    notes: `audit_claims`, `plan_curriculum` output shape); full `pnpm verify`; run every
    quickstart.md scenario and record evidence in `tasks/status.json`.

## Complexity Tracking

> Filled ONLY if Constitution Check has violations that must be justified.

No constitution violations: the design adds pure modules and one budgeted model call inside
existing stages, introduces no new package, no direct provider call, no status-writing path and
no weakened gate. Table intentionally empty.
