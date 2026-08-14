# Research: Content Engine Quality (E24)

**Phase 0 output of `/speckit-plan`** | Branch `001-content-engine-epic` | 2026-08-14

Every uncertainty in the feature spec was resolved against `specs/constitution.md`,
`specs/quality.md`, `docs/PRODUCT.md`, the evaluation pack (`packages/evaluation/src/`), the
compile pipeline (`apps/worker/src/pipeline/compile.ts`) and the published contracts
(`packages/ai-contracts/src/contracts.ts`, `specs/generation-schemas/`). No unresolved
clarification markers remain; each decision below records what was chosen, why, and the
alternatives rejected.

---

## R1 — The human-sounding rubric is deterministic, never model-graded

- **Decision**: Add a `human_sounding` dimension to the evaluation scorer
  (`packages/evaluation/src/scorer.ts`), implemented as deterministic per-lesson checks, with a
  published floor and a published rubric document (`packages/evaluation/HUMAN_SOUNDING_RUBRIC.md`).
- **Rationale**: `scorer.ts` states the pack's doctrine: "Nothing here calls a model … a scorer
  that asks a model to grade a model's output inherits its blind spots, and the point of this
  pack is to be the thing that does not." Constitution §7 (cost is a design input) and the
  latency budget (`docs/ARCHITECTURE.md`, Day 1 < 3 min, course < 10 min at p90) both forbid a
  per-lesson model-graded pass. The four structural elements map to machine-checkable signals in
  the existing `LessonPackage` contract, so determinism is free.
- **Alternatives considered**: (a) LLM-as-judge rubric — rejected: inherits generator blind spots
  and adds provider calls per lesson; (b) regex-only single score — rejected: cannot name the
  failing element, which FR-005/FR-006 require.

## R2 — The four structural elements map to existing contract fields

- **Decision**: Each lesson scores 0/1 per element:
  1. **Concrete opening** — the first sentence (up to the first `.`, `!` or `?`) must not match
     meta-opening patterns (`in this lesson`, `this lesson will`, `in this chapter`,
     `today we will`, `we will cover`, `welcome to`, `let's learn about`, `this module`,
     `now that you`, references to "the lesson"/"the course"/"the generation") and must contain a
     concrete subject (a sentence ≥ 5 words that is not a meta statement).
  2. **One idea per segment** — split the script into segments (paragraph breaks, else sentence
     boundaries); every segment must be a grammatically complete sentence (ends with terminal
     punctuation), must not start with list markers (`-`, `*`, `•`, `1.`), and there must be at
     least 2 segments.
  3. **Worked example** — the lesson's `examples` array has ≥ 1 entry of ≥ 2 sentences, or the
     script contains a step-by-step block signalled by `step`, `first … then`, or an enumerated
     sequence; FR-003 requires the example be worked *within the script*, so an entry that is
     referenced but never narrated scores 0.
  4. **Checkpoint question** — `lesson.pausePrompts.length >= 1` and the first prompt's text
     appears in the script (the checkpoint must actually pause the spoken lesson).
- **Rationale**: `pausePrompts` is literally "Prompts embedded in the audio that force a
  response before continuing" (`packages/ai-contracts/src/contracts.ts`), i.e. the checkpoint
  mechanism already exists; `examples` is the worked-example slot; segmentation is a pure string
  function like the existing `UNSPEAKABLE` checks in `scorer.ts`.
- **Alternatives considered**: LLM segmentation ("one idea" is semantic) — rejected for R1
  reasons; the degradation suite (R3) is what proves the proxy is not decorative.

## R3 — Verification of the four elements is a domain gate, not only a score

- **Decision**: Add `checkLessonStructure(lesson)` to `verifyLesson`
  (`packages/domain/src/verification/verifier.ts`) with a new finding category `script_structure`
  at `critical` severity when any element is missing. Because `blocksPublication` treats
  `critical` findings as blocking, a script missing an element is repaired (≤ 2 attempts) or
  excluded via the existing `decideRepair` loop — exactly FR-007 ("verified before publication,
  so a script missing an element is repaired or excluded rather than shipped").
- **Rationale**: The pipeline already wires `verifyLesson` → `blocksPublication` → `decideRepair`
  → `repair_artefact` in `apps/worker/src/pipeline/compile.ts` (`compileDay`). Adding a structural
  check inside the verifier gives the *enforcement* for free; the evaluation dimension gives the
  *measurement*.
- **Alternatives considered**: a separate post-generation gate — rejected: would duplicate the
  repair loop and cost a second pass.

## R4 — Plan attempts are recorded in the `plan_curriculum` step output

- **Decision**: Change the private `planCurriculum` in
  `apps/worker/src/pipeline/compile.ts` to return `{ plan, attempts }` where `attempts` is the
  ordered list of `{ attempt, violations: string[], passed: boolean }` for every planner call in
  the run (first attempt included). The `plan_curriculum` step output becomes this object; the
  caller stores `result.plan`. Bump `PIPELINE_VERSION` from `'1.0.0'` to `'1.1.0'` so runs
  created after the change record the new shape and old in-flight runs are not resumed against
  the new reader.
- **Rationale**: FR-014 says "the plan step MUST record which invariants were violated". The
  step output is the idempotent, resume-safe store (`runStep` reuses `succeeded` outputs by key,
  `decideStep` in `packages/domain/src/generation/state-machine.ts`), and
  `uow.generation.listSteps`/`getStep` already expose it to any harness. No schema or migration
  is needed.
- **Alternatives considered**: (a) audit findings per rejection — rejected: no `details` column,
  so the per-invariant breakdown would have to be parsed from free text; (b) a new
  `plan_attempt` step per rejection — rejected: multiplies step rows and complicates the
  idempotency key.

## R5 — Hit rate is measured by a harness and guarded by a gate test

- **Decision**: Build `tests/evaluation/plan-hit-rate.test.ts` (fake mode: compiles `eval_01`
  through the real pipeline exactly as `tests/evaluation/reference-pack.test.ts` does, reads the
  `plan_curriculum` step output, asserts first-attempt validity and prints the per-invariant
  breakdown), a reusable runner `scripts/measure-plan-hit-rate.ts` (fake: `eval_01`; live: all
  ten fixtures when `GAPOS_PROVIDER_MODE=live`), and a guard test
  (`tests/evaluation/plan-gate-guard.test.ts`) that proves `findPlanViolations`
  (`packages/domain/src/curriculum/plan-validation.ts`) still rejects every known-bad shape —
  over-budget day, untaught objective, unassessed objective, prerequisite cycle, unmet
  prerequisite, source-grounded objective with no locator — with all violations returned
  together (FR-012/FR-013/FR-015).
- **Rationale**: The definition of "first attempt" in the spec's Assumptions (first planner
  output, before any repair round, counting compiles not attempts) is exactly the first element
  of the recorded `attempts` array. The fake provider returns the valid `referencePlan` on the
  first call, so the fake gate reads 100% on `eval_01`; the live gate (which already compiles
  all ten fixtures, `tests/evaluation/live-provider.test.ts`) measures the 80% target on the
  full pack.
- **Alternatives considered**: measuring via provider call counts — rejected: call counts do not
  say *which invariant* failed, and FR-014 requires the per-invariant record.

## R6 — Personalization is a deterministic pure function plus a five-input planner brief

- **Decision**: Add `packages/domain/src/curriculum/personalisation.ts` with
  `derivePlanInputs(normalisation, diagnostic, profile, mastery)` and
  `personalisePlan(plan, inputs)`. `personalisePlan` is deterministic and revalidated by
  `findPlanViolations` after adaptation (it must preserve the time budget, coverage and
  prerequisite invariants). `compileGap` gathers the five inputs (gap, evidence, diagnostic,
  `uow.users.find(owner)` profile, prior/mastery evidence), renders them into `learnerBrief`, and
  applies `personalisePlan` to the planner's output before the curriculum is stored
  (`apps/worker/src/pipeline/compile.ts`).
- **Rationale**: Constitution §1 fixes the function `curriculum = f(gap, sources, diagnostic,
  learner profile, mastery evidence)`. The current pipeline already passes gap, evidence and
  diagnostic; profile and per-objective mastery evidence are missing (verified: no
  `LearnerProfile` in code; mastery repo exists at `uow.mastery.listEvidenceForCurriculum`).
  Keeping the adaptation deterministic preserves the idempotency promise (spec Assumptions:
  "planning stays deterministic") and makes the differentiation test runnable against the fake
  provider.
- **Alternatives considered**: (a) personalization only via prompt — rejected: not testable
  deterministically, and the fake provider ignores prompts; (b) a per-user plan cache — rejected:
  same-idempotency, different-inputs semantics already covered by `personalisePlan`.

## R7 — Learner profile is two new columns on `users`

- **Decision**: Add `preferred_lesson_length` (`'short' | 'standard' | 'long'`, default
  `'standard'`) and `goals` (text array, default `[]`) to the `User` record
  (`packages/database/src/repositories/types.ts`), backed by a new forward-only migration
  `packages/database/src/migrations/006_learner_profile.sql` (existing pattern: numbered SQL
  files applied by `packages/database/src/migrate.ts`, run via `pnpm db:migrate`). Update both
  repository implementations (`memory.ts`, `postgres.ts`).
- **Rationale**: `docs/PRODUCT.md` lists LearnerProfile (goals, preferred lesson length, baseline
  domains) as an entity but it has no table or repo; FR-019 requires profile shape to influence
  plan shape. Two nullable/defaulted columns are the smallest change; accessibility preferences
  stay on the existing user surface (locale/timezone) and are out of scope for this epic's plan
  shape. AGENTS.md rule 5 (forward-only migrations) is respected: the new file is additive.
- **Alternatives considered**: a separate `learner_profiles` table — rejected: one profile per
  user, so columns on `users` are simpler and avoid a join in the compile hot path.

## R8 — Unsupported-claim audit is a versioned contract step in the `auditing` stage

- **Decision**: Add `ClaimAuditContract` (`claim_audit`, v1.0.0) to
  `packages/ai-contracts/src/contracts.ts` (findings with `targetId`, `category:
  'unsupported_claim'`, `severity`, `claim`, `citedLocators`, `resolution:
  'removed' | 'repaired' | 'labelled' | 'none'`, `supportingLocator?`), regenerate
  `specs/generation-schemas/claim_audit.v1-0-0.json` via `pnpm specs:generate`, add a
  `audit_claims` generation step (`GENERATION_STEPS` in
  `packages/domain/src/generation/state-machine.ts`), and run it per published lesson inside the
  existing `auditing` stage of `compileGap`. Findings are recorded via
  `uow.generation.addFinding` with `category: 'unsupported_claim'`; a claim whose resolution is
  `none` yields a `critical` finding so the existing repair/exclude loop refuses it before
  publication (FR-009/FR-010). `repairStatus` on the finding carries the resolution
  (`repaired` / `excluded` / `accepted` for labelled).
- **Rationale**: The `auditing` stage already exists in the state machine and `compileGap`
  already records findings there (prompt-injection scan, objective-coverage gaps). The contract
  boundary (AGENTS.md rule 3) is preserved: model output is schema-validated before persistence.
  The audit step's input version is `hash(lesson)`, so it is idempotent and never double-charges
  (constitution §7).
- **Alternatives considered**: audit as a prompt inside the lesson-generation call — rejected:
  a generator auditing itself is the exact failure `assertIndependentVerifier` exists to
  prevent; audit as part of the verification report — rejected: `VerificationReportContract`
  already has a fixed category enum and a distinct purpose (independent solutions).

## R9 — Traceability is a pure invariant function plus a user-visible surface

- **Decision**: Add `assertTraceability(plan, lessons, evidence)` to
  `packages/evaluation/src/traceability.ts` (pure; returns findings): every objective, lesson and
  question must declare `basis` and, when `basis === 'source'`, cite ≥ 1 locator whose
  `sourceId`/`chunkId` resolves to a real chunk in the supplied evidence; `general_knowledge`
  items must be labelled (FR-008). Wire the user-visible half in
  `apps/web/src/app/gaps/[gapId]/study/page.tsx`: render the lesson's locators in the Listen
  section and each question's locators before answering (the correction surface already shows
  them after answering via `attempt-form.tsx` → `practice-feedback.tsx`), each linking to the
  Sources tab chunk anchor `/gaps/{gapId}?tab=sources#chunk-{chunkId}` (SC-006: one step away).
- **Rationale**: `scoreSourceFaithfulness` in `scorer.ts` measures *share*; FR-008/SC-003 demand
  an all-or-nothing invariant, which the pure function + test provides. The study page already
  resolves `locators` into `AttemptQuestion.locators` with source names (read in this research),
  so the new surface is additive and small — the spec's Assumptions name it "the only new
  user-facing surface".
- **Alternatives considered**: a DB-level constraint on locators — rejected: locators live inside
  JSONB contract payloads; a pure check is simpler and testable without a database.

## R10 — The regression gate absorbs the new dimension and records baselines

- **Decision**: `human_sounding` joins `SCORE_DIMENSIONS` and `SCORE_FLOORS`
  (`packages/evaluation/src/fixture.ts`). The floor is calibrated from the reference curricula
  (the deterministic fake `referenceLesson` fixtures in `packages/test-fixtures/` and, where
  available, recorded live scores), documented in `HUMAN_SOUNDING_RUBRIC.md`, then recorded into
  `tasks/evaluation-baselines.json` via `scripts/record-eval-baselines.ts` (which already reads
  `toBaseline`/`compareToBaseline`). `tests/evaluation/reference-pack.test.ts` asserts the new
  floor on `eval_01` and adds the degradation cases (meta-opening, list-like prose, no worked
  example, no checkpoint → below floor, failing element named). `tests/evaluation/live-provider.test.ts`
  asserts the floor + no regression on the live fixtures.
- **Rationale**: FR-021 says the human-sounding dimension is additive and no existing floor may
  be lowered; FR-022 requires a runnable measurement with recorded evidence. Because the gate
  loops over `SCORE_DIMENSIONS` (`reference-pack.test.ts` `it.each`), adding the dimension to
  the array extends the existing gate automatically.
- **Alternatives considered**: a separate baseline file — rejected: the existing
  `tasks/evaluation-baselines.json` + `record-eval-baselines.ts` flow is the deliberate
  baseline-update path the spec's Assumptions reference.

---

## Resolved unknowns

| Unknown | Resolution | Evidence |
|---|---|---|
| Where the rubric lives and how it is scored | `packages/evaluation`, deterministic dimension | R1, R2; `scorer.ts` doctrine; quality.md §10 |
| How FR-007 "verify before publication" is enforced | domain verifier `script_structure` category, critical → repair/exclude | R3; `verifier.ts` `blocksPublication`/`decideRepair` |
| How the hit rate is measured and what "first attempt" means | `plan_curriculum` step output `{ plan, attempts }`, harness + guard test | R4, R5; spec Assumptions; `listSteps` in `types.ts` |
| How personalization enters a deterministic pipeline | pure `personalisePlan` + five-input `learnerBrief` | R6; constitution §1; spec Assumptions (idempotency) |
| Where LearnerProfile lives | new columns on `users` (migration 006) | R7; PRODUCT.md entity table; AGENTS.md rule 5 |
| How unsupported claims are audited with recorded resolution | `claim_audit` contract + `audit_claims` step in `auditing` | R8; FR-009/FR-010; existing finding repo |
| How traceability becomes an invariant + user-visible | pure `assertTraceability` + study-page locator links | R9; FR-008/FR-011, SC-003/SC-006 |
| How the regression gate absorbs the new dimension | `SCORE_DIMENSIONS`/`SCORE_FLOORS` + baselines flow | R10; FR-021/FR-022 |
| How the checkpoint pauses the learner (US1 AS3) | existing `pausePrompts`; study-page checkpoint UI pauses audio and requires a response before continuing | R2; `LessonPackage.pausePrompts`; `apps/web/src/app/gaps/[gapId]/study/page.tsx` |
