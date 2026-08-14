---

description: "Task list template for feature implementation"
---

# Tasks: Content Engine Quality (E24)

**Input**: Design documents from `/specs/001-content-engine-epic/`

**Prerequisites**: [plan.md](plan.md) (required), [spec.md](spec.md) (required for user stories),
[research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/README.md),
[quickstart.md](quickstart.md)

**Tests**: Test tasks ARE included — the feature spec mandates an Independent Test per user story
and the working contract requires test-first implementation (AGENTS.md §3 step 7, Constitution §4
"evidence over assertion"). Each test task is written FIRST and must FAIL before its
implementation task begins (template rule: "Verify tests fail before implementing").

**Organization**: Tasks are grouped by user story to enable independent implementation and
testing of each story. MVP scope = User Story 1 (script quality) plus its foundational
prerequisites.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Monorepo (see [plan.md](plan.md) — Project Structure): `packages/*/src/…`, `apps/worker/src/…`,
`apps/web/src/…`, `tests/evaluation/…`, `tests/end-to-end/…`, `scripts/…`, `specs/…`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Baseline the tree so every later claim has a comparison point (FR-022, SC-008).

- [x] T001 Run the baseline gate `env -u GAPOS_PROVIDER_MODE -u GAPOS_LLM_MODEL pnpm verify` on a
      clean tree and record the pass/skip counts and commit hash in `tasks/status.json` (the
      sandbox injects live mode without a key; CI does not — same note as GAP-034/GAP-035).

**Checkpoint**: Baseline recorded; every task below starts from a known-green tree.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Contract and measurement surfaces that MUST exist before ANY user story. These are
the C-03, C-04, C-05 and R9 surfaces from [contracts/](contracts/README.md).

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 [P] Add `'script_structure'` to `VERIFICATION_CATEGORIES` in
      `packages/ai-contracts/src/contracts.ts` and to `FindingCategory` in
      `packages/domain/src/verification/verifier.ts`; extend
      `packages/ai-contracts/src/contracts.test.ts` (test-first: the schema accepts a
      verification finding with the new category); run `pnpm specs:generate` and commit the
      regenerated `specs/generation-schemas/verification_report.v1-0-0.json`
- [x] T003 [P] Add `ClaimAuditContract` and `CLAIM_RESOLUTIONS =
      ['removed','repaired','labelled','none']` to `packages/ai-contracts/src/contracts.ts`,
      register in `ALL_CONTRACTS` and `CONTRACT_NAMES`
      (`packages/ai-contracts/src/versioning.ts`); extend `contracts.test.ts` (test-first:
      accepts a full audit report, rejects a malformed resolution); run `pnpm specs:generate` →
      commit `specs/generation-schemas/claim_audit.v1-0-0.json`
- [x] T004 [P] Add `'audit_claims'` to `GENERATION_STEPS` in
      `packages/domain/src/generation/state-machine.ts` and assert it in
      `packages/domain/src/generation/state-machine.test.ts` (test-first)
- [x] T005 Rework `planCurriculum` in `apps/worker/src/pipeline/compile.ts` to return
      `{ plan, attempts }` (`PlanAttempt`/`PlanCurriculumResult`: ordered per-call
      `{ attempt, violations: string[], passed }`), make `compileGap` store `result.plan`, bump
      `PIPELINE_VERSION` to `'1.1.0'`. Test-first: `tests/evaluation/plan-hit-rate.test.ts`
      compiles `eval_01` through the real pipeline and reads the `plan_curriculum` step output
      via `uow.generation.listSteps`, asserting `attempts.length ≥ 1` and
      `attempts[0].passed === true` on the reference pack
- [x] T006 [P] Add `assertTraceability(plan, lessons, evidence)` to
      `packages/evaluation/src/traceability.ts` (pure: every objective/lesson/question declares a
      `basis`; `source` items cite ≥ 1 locator whose `sourceId`/`chunkId` resolves to a real
      evidence chunk; `general_knowledge` items are labelled). Test-first:
      `tests/evaluation/traceability.test.ts` fails on a curriculum with an item lacking a
      locator or citing a non-existent chunk

**Checkpoint**: Foundation ready — user story implementation can now begin in parallel.

---

## Phase 3: User Story 1 - Every lesson reads like a real teacher wrote it (Priority: P1) 🎯 MVP

**Goal**: Every published lesson script on the reference packs clears the `human_sounding`
rubric floor (concrete opening, one idea per segment, worked example, checkpoint); a script
missing an element is repaired or excluded before publication; the checkpoint pauses the learner
and requires a response.

**Independent Test**: Score every published lesson script of a compiled reference curriculum
against the rubric (floor cleared); degrade a script into a model-dump form and confirm it
scores below the floor with the failing element named (FR-005/FR-006, SC-002).

### Tests for User Story 1 (write FIRST, ensure they FAIL before implementation) ⚠️

- [x] T007 [P] [US1] Add the four human-sounding degradation tests to
      `tests/evaluation/reference-pack.test.ts`: meta-opening, list-like/bulleted prose, no
      worked example, no checkpoint → each scores below `SCORE_FLOORS.human_sounding` and the
      observation names the failing element (depends on the dimension existing — red until T013)
- [x] T008 [P] [US1] Add `checkLessonStructure` unit tests to
      `packages/domain/src/verification/verifier.test.ts`: a lesson missing any element yields a
      `critical` `script_structure` finding naming it; a complete lesson yields none
- [x] T009 [P] [US1] Add a pipeline test to `tests/end-to-end/compile-math-gap.test.ts`: with a
      scripted faulty lesson (missing checkpoint, from `packages/test-fixtures/src/faulty-fixtures.ts`),
      the lesson is repaired or excluded and never published
- [x] T010 [P] [US1] Add checkpoint UI tests to `apps/web/src/components/screens.test.tsx` and
      `apps/web/src/components/audio-player.test.tsx`: audio pauses at the `pausePrompt`
      position, a response is required before continuing, correct → confirm, incorrect →
      correction surface with the verified answer and source link

### Implementation for User Story 1

- [x] T011 [US1] Append `'human_sounding'` to `SCORE_DIMENSIONS` and add the floor to
      `SCORE_FLOORS` in `packages/evaluation/src/fixture.ts` (floor value set in T015)
- [x] T012 [US1] Implement the four element detectors in
      `packages/domain/src/curriculum/script-structure.ts` (concrete opening via meta-pattern
      rejection; one idea per segment via paragraph/sentence segmentation; worked example via
      `examples` present in the script or a step block; checkpoint via `pausePrompts` with the
      prompt text in the script), export from `packages/domain/src/index.ts` — the single source
      of truth for both the scorer and the domain verifier (C-02/C-03)
- [x] T013 [US1] Implement `scoreHumanSounding` in `packages/evaluation/src/scorer.ts` and
      register it in `scoreCurriculum` (dimension score = share of lessons passing all four
      checks; observations name the missing element) (depends T011, T012)
- [x] T014 [US1] Publish `packages/evaluation/HUMAN_SOUNDING_RUBRIC.md`: the prose rubric, the
      deterministic detection rules, the floor and the calibration record
- [x] T015 [US1] Calibrate `SCORE_FLOORS.human_sounding` against the reference curricula
      (`packages/test-fixtures/src/reference-curriculum.ts` `referenceLesson` fixtures) so the
      `eval_01` reference curriculum clears the floor; record the calibration command + scores in
      `tasks/status.json` (depends T013)
- [x] T016 [US1] Implement `checkLessonStructure` in
      `packages/domain/src/verification/verifier.ts` using the shared detectors (C-03) and wire
      it into `verifyLesson` (depends T002, T012)
- [x] T017 [US1] Update the `generateLesson` instruction in
      `apps/worker/src/pipeline/compile.ts` to demand the four structural elements (concrete
      opening, one idea per segment, worked example worked inside the script, checkpoint via
      `pausePrompts`); add `lessonMissingCheckpoint()` to
      `packages/test-fixtures/src/faulty-fixtures.ts` (depends T009)
- [x] T018 [US1] Implement the checkpoint surface: `apps/web/src/components/checkpoint.tsx` +
      pause-at-pausePrompt in `apps/web/src/components/audio-player.tsx` + render in
      `apps/web/src/app/gaps/[gapId]/study/page.tsx`; grade the checkpoint like any practice
      answer (reuse `apps/web/src/components/practice-feedback.tsx` — correct → confirm,
      incorrect → verified answer + source link) (depends T010)

**Checkpoint**: US1 fully functional and testable independently — every published script on the
reference pack clears the floor; missing elements are repaired/excluded, never shipped; the
lesson pauses at the checkpoint and requires a response before continuing (US1 AS3).

---

## Phase 4: User Story 2 - Every objective and every claim points back to its source (Priority: P1)

**Goal**: 100% of published objectives, lessons and questions carry a source locator or an
explicit general-knowledge label; unsupported claims get a recorded resolution (removed /
repaired / labelled) before publication; items citing injected chunks are refused; locators are
user-visible one step from the source.

**Independent Test**: Invariant tests assert 100% traceability on the reference pack and that
every audit-recorded unsupported claim has a resolution before publication; component tests
assert the source-link affordance (FR-008/FR-009/FR-011, SC-003/SC-006).

### Tests for User Story 2 (write FIRST, ensure they FAIL before implementation) ⚠️

- [x] T019 [P] [US2] Add traceability invariant tests to `tests/evaluation/traceability.test.ts`
      against the compiled `eval_01` reference curriculum: 100% of objectives/lessons/questions
      carry a locator or a general-knowledge label and every locator resolves to a real evidence
      chunk (depends T006)
- [x] T020 [P] [US2] Add claim-audit pipeline tests to `tests/end-to-end/compile-math-gap.test.ts`
      (fake provider): an unresolved claim blocks publication; a labelled resolution publishes
      with the finding's `repairStatus: 'accepted'`; the clean default publishes unchanged
      (depends T003, T004)
- [x] T021 [P] [US2] Add injection-chunk refusal tests to
      `packages/domain/src/verification/verifier.test.ts`: an item whose evidence cites a chunk
      in `context.injectionSignals` gets a `critical` finding
- [x] T022 [P] [US2] Add source-links render tests to `apps/web/src/components/screens.test.tsx`:
      lesson + question locators render as links to `/gaps/{gapId}?tab=sources#chunk-{chunkId}`,
      a general-knowledge item renders the explicit label, and the link has a visible
      focus-visible rule

### Implementation for User Story 2

- [x] T023 [US2] Wire the `audit_claims` step into the `auditing` stage of `compileGap` in
      `apps/worker/src/pipeline/compile.ts` (`runStep` with `inputVersion: hash(lesson)`);
      record findings via `uow.generation.addFinding` with `category: 'unsupported_claim'` and
      `repairStatus` = resolution (`repaired` / `excluded` / `accepted`); `resolution: 'none'`
      findings are `critical` so `decideRepair` refuses the lesson (depends T020)
- [x] T024 [US2] Extend `checkSourceSupport` in
      `packages/domain/src/verification/verifier.ts` to refuse evidence locators whose `chunkId`
      is in `context.injectionSignals`; thread the injection signals into the verification
      context from `compileGap` (depends T021)
- [x] T025 [US2] Implement `apps/web/src/components/source-links.tsx` and wire it into the study
      page (`apps/web/src/app/gaps/[gapId]/study/page.tsx`: Listen-section locators +
      per-question locators before answering in `apps/web/src/components/attempt-form.tsx`); add
      `id="chunk-{chunkId}"` anchors to the Sources tab rows
      (`apps/web/src/app/gaps/[gapId]/page.tsx?tab=sources`) (depends T022)
- [x] T026 [US2] Add `claimAuditClean()`, `claimAuditUnresolved()`, `claimAuditLabelled()`
      fixtures to `packages/test-fixtures/src/faulty-fixtures.ts` (depends T003)

**Checkpoint**: US2 fully functional — the traceability invariant is green on the reference
pack; every unsupported claim found by the audit is removed/repaired/labelled with the finding
recorded before publication; injected chunks are never cited; every published item shows its
source one step away.

---

## Phase 5: User Story 3 - Compiles produce a valid plan on the first attempt (Priority: P1)

**Goal**: The first planner output passes the full validation gate ≥ 80% of the time on the
reference packs, measured by a runnable harness, with the per-invariant breakdown named and the
gate proven just as strict.

**Independent Test**: `tests/evaluation/plan-hit-rate.test.ts` + `scripts/measure-plan-hit-rate.ts`
report first-attempt valid rate and per-invariant rejections; `tests/evaluation/plan-gate-guard.test.ts`
proves every known-bad plan shape is still rejected (FR-012/FR-013/FR-014/FR-015, SC-001).

### Tests and tooling for User Story 3 (write FIRST, ensure they FAIL before implementation) ⚠️

- [x] T027 [US3] Write `tests/evaluation/plan-hit-rate.test.ts`: compiles `eval_01` through the
      real pipeline (fake provider), reads the `plan_curriculum` step output via
      `uow.generation.listSteps`, asserts `attempts[0].passed === true` on the reference pack and
      asserts the harness prints the per-invariant violation breakdown (depends T005)
- [x] T028 [US3] Write `tests/evaluation/plan-gate-guard.test.ts`: `findPlanViolations`
      (`packages/domain/src/curriculum/plan-validation.ts`) rejects every known-bad shape —
      over-budget day, untaught objective, unassessed objective, prerequisite cycle, unmet
      prerequisite, source-grounded objective with no locator — and returns all violations
      together in one result (FR-015)
- [x] T029 [US3] Implement `scripts/measure-plan-hit-rate.ts`: fake mode compiles `eval_01`;
      live mode (`GAPOS_PROVIDER_MODE=live`) compiles all ten fixtures; prints
      `first-attempt valid X/Y (Z%)` + a per-invariant table; run the fake mode and record the
      output in `tasks/status.json` (FR-022)
- [x] T030 [US3] Planner improvement pass in `planCurriculum`
      (`apps/worker/src/pipeline/compile.ts`): strengthen the instruction with a per-invariant
      checklist (budget arithmetic per day, teach-and-assess coverage, acyclic prerequisites,
      locator citations, verbatim external prerequisites, non-decreasing difficulty) and a
      failure-mode glossary; re-run `scripts/measure-plan-hit-rate.ts` and iterate until the live
      pack first-attempt rate ≥ 80% (SC-001) while `tests/evaluation/plan-gate-guard.test.ts`
      stays green — `findPlanViolations` is never weakened (depends T027, T028, T029)

**Checkpoint**: US3 fully functional — the hit rate is a measured, reproducible number; the
weakest invariant is diagnosable; the gate rejects every known-bad shape.

---

## Phase 6: User Story 4 - No two learners get the same curriculum (Priority: P2)

**Goal**: The curriculum is a deterministic function of gap + sources + diagnostic + learner
profile + mastery evidence; mastered prerequisites are not retaught (≤ 5-minute Day-1 recall
unless decayed, then re-demonstrated); profile goals and preferred lesson length shape the plan
within the daily budget.

**Independent Test**: `tests/evaluation/differentiation.test.ts` compiles the same gap + sources
for differing diagnostics/profiles/mastery and asserts measurably different curricula;
`packages/domain/src/curriculum/personalisation.test.ts` proves the reuse and decay rules
(FR-016…FR-020, SC-004).

### Tests for User Story 4 (write FIRST, ensure they FAIL before implementation) ⚠️

- [x] T031 [US4] Write `packages/domain/src/curriculum/personalisation.test.ts`: two learners
      differing in only one of diagnostic/profile/mastery yield measurably different plans;
      a satisfied prerequisite is at most a 5-minute Day-1 recall activity; a decayed capability
      is re-demonstrated; every adapted plan passes `findPlanViolations`
- [x] T032 [US4] Write the profile migration + repo tests: forward-only
      `packages/database/src/migrations/006_learner_profile.sql`
      (`ALTER TABLE users ADD COLUMN preferred_lesson_length … , ADD COLUMN goals …`), applied
      via `pnpm db:migrate`; update `User` in `packages/database/src/repositories/types.ts` and
      both `memory.ts`/`postgres.ts` with repository tests (defaults `'standard'` / `[]`,
      union validation)

### Implementation for User Story 4

- [x] T033 [US4] Implement `packages/domain/src/curriculum/personalisation.ts`
      (`derivePlanInputs` + `personalisePlan`: recall-conversion of satisfied prerequisites,
      re-demonstration scheduling for decayed, activity rescaling for
      `preferredLessonLength`, Day-1 difficulty from the diagnostic, goals in the brief) and
      export from `packages/domain/src/index.ts` (depends T031)
- [x] T034 [US4] Thread the five inputs into `compileGap`
      (`apps/worker/src/pipeline/compile.ts`): read the profile via `uow.users.find(owner)`,
      mastery evidence via `uow.mastery.listEvidenceForCurriculum` + `classifyPriorCapabilities`;
      render profile + mastery into `learnerBrief`; apply `personalisePlan` before
      `uow.curricula.create` (depends T032, T033)
- [x] T035 [US4] Write `tests/evaluation/differentiation.test.ts`: same gap + same sources with
      differing profile/diagnostic/mastery → curricula differ measurably (SC-004); `eval_10`
      prior-mastery fixture: mastered prerequisites are not retaught (at most a Day-1 recall
      check) (depends T034)

**Checkpoint**: US4 fully functional — personalization is a demonstrated, deterministic
property; reuse and decay behave per the spec; identical inputs still yield identical outputs
(idempotency preserved).

---

## Phase 7: User Story 5 - Quality regressions are caught before learners see them (Priority: P2)

**Goal**: The evaluation gate runs on every verification, re-scores the reference packs against
stored baselines including the new `human_sounding` dimension, and fails any slip beyond
tolerance, naming the dimension.

**Independent Test**: baseline comparison tests + the degradation suite; a regression beyond
`REGRESSION_TOLERANCE` fails the gate and names the dimension (FR-021/FR-022, SC-005/SC-008).

### Tests for User Story 5 (write FIRST, ensure they FAIL before implementation) ⚠️

- [x] T036 [US5] Extend `tests/evaluation/live-provider.test.ts`: every live fixture clears the
      `human_sounding` floor and no dimension regresses beyond `REGRESSION_TOLERANCE` against
      `tasks/evaluation-baselines.json` (depends T013, T015)
- [x] T037 [US5] Record baselines including `human_sounding` via
      `scripts/record-eval-baselines.ts` into `tasks/evaluation-baselines.json` (deliberate,
      review-gated flow; record the command + result in `tasks/status.json` — never silent)
- [x] T038 [US5] Audit the degradation suite in `tests/evaluation/reference-pack.test.ts`: every
      dimension (including `human_sounding`) has a defect case that fails it; add any missing
      case so the gate cannot be decorative (FR-021)

**Checkpoint**: US5 fully functional — the gate notices the day a score slips even when it still
clears the floor, and every claimed improvement is reproducible from a recorded command.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, governance wiring and final evidence (Constitution §4, AGENTS.md §6).

- [x] T039 [P] Update `docs/PRODUCT.md` (LearnerProfile fields, hit-rate measurement,
      `audit_claims` step), `docs/ARCHITECTURE.md` (stage notes: `plan_curriculum` output shape
      `{ plan, attempts }`, `audit_claims` in `auditing`, latency note for the added audit call),
      and `specs/quality.md` §10/§12 (add the `human_sounding` row to the enforcement table)
- [x] T040 [P] Mirror the E24 task set into `tasks/backlog.yaml` (new GAP ids, `epic: E24`,
      dependencies per the graph below) so the AGENTS.md controller can pick tasks from
      `tasks/backlog.yaml` and record progress in `tasks/status.json`
- [x] T041 [P] Run the full gate `env -u GAPOS_PROVIDER_MODE -u GAPOS_LLM_MODEL pnpm verify` and
      record the result in `tasks/status.json`
- [x] T042 [P] Run every scenario in `specs/001-content-engine-epic/quickstart.md` and record the
      outputs (SC-008 reproducibility)
- [x] T043 Review the final diff for unrelated changes, secrets and scope drift; commit one
      coherent change per logical group (AGENTS.md §3, §10)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — baseline only.
- **Foundational (Phase 2)**: After Setup. BLOCKS all user stories (T002 → US1 gate,
  T003/T004 → US2 audit, T005 → US3 harness, T006 → US2 invariant).
- **User Stories (Phase 3+)**: After Foundational. US1, US2, US3 (P1) can start in parallel once
  Phase 2 completes; US4 and US5 (P2) build on the P1 stories as noted.
- **Polish (Phase 8)**: After all desired stories are complete.

### User Story Dependencies

- **US1 (P1)**: depends on T002 (script_structure category), T012 (detectors). No dependency on
  other stories.
- **US2 (P1)**: depends on T003/T004 (claim audit), T006 (traceability helper), T022 (UI tests).
  Independent of US1 except shared files (`packages/domain/src/verification/verifier.ts` is
  touched by T016 and T024 — sequence T016 before T024 to avoid a same-file conflict).
- **US3 (P1)**: depends on T005 (plan attempt record). Touches
  `apps/worker/src/pipeline/compile.ts` in T005/T017/T023/T030/T034 — execute in task order;
  T030 (planner instruction) is the only same-function edit with T017/T034 and should be last.
- **US4 (P2)**: depends on T031→T034 chain; T034 touches `compileGap` shared with US2/US3 —
  execute after T023 and T030.
- **US5 (P2)**: depends on US1 (T013/T015) for the dimension and baselines; independent of US3.

### Within Each User Story

- Tests (included) MUST be written and FAIL before implementation.
- Detectors/models before services; services before pipeline wiring; pipeline before UI.
- Story complete before moving to the next priority (P1 stories before P2).

### Parallel Opportunities

- All Phase 2 foundational tasks (T002–T006) are marked [P] and can run in parallel.
- All US1 test tasks (T007–T010) run in parallel; T011/T012 then T013/T014/T016.
- All US2 test tasks (T019–T022) run in parallel; T023/T024 then T025/T026.
- T027/T028 (US3 tests) run in parallel.
- T031/T032 (US4) run in parallel.
- T036/T038 (US5 tests) run in parallel.
- All Polish tasks (T039–T043) are [P].

### Shared-file sequencing (avoid conflicts)

| File | Tasks | Rule |
|---|---|---|
| `packages/domain/src/verification/verifier.ts` | T016, T024 | T016 before T024 |
| `apps/worker/src/pipeline/compile.ts` | T005, T017, T023, T030, T034 | task order; T030 last among T017/T023 edits; T034 after T023 |
| `tests/evaluation/reference-pack.test.ts` | T007, T038 | T007 before T038 |
| `apps/web/src/components/screens.test.tsx` | T010, T022 | T010 before T022 |

---

## Parallel Example: User Story 1

```bash
# Launch all US1 tests together (write FIRST, confirm red):
Task: "T007 degradation tests in tests/evaluation/reference-pack.test.ts"
Task: "T008 checkLessonStructure unit tests in packages/domain/src/verification/verifier.test.ts"
Task: "T009 faulty-lesson pipeline test in tests/end-to-end/compile-math-gap.test.ts"
Task: "T010 checkpoint UI tests in apps/web/src/components/screens.test.tsx"

# Launch the rubric surface together:
Task: "T011 dimension in packages/evaluation/src/fixture.ts"
Task: "T012 detectors in packages/domain/src/curriculum/script-structure.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001).
2. Complete Phase 2: Foundational — at minimum T002 + T012 prerequisites (CRITICAL: blocks US1).
3. Complete Phase 3: US1 (T007 → T018).
4. **STOP and VALIDATE**: every published script on the reference pack clears the
   `human_sounding` floor; degradation cases fail below the floor; the checkpoint pauses the
   learner. Deploy/demo if ready.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → test independently → the MVP quality contract (SC-002) is enforced.
3. US2 → traceability invariant + audit + source links (SC-003/SC-006).
4. US3 → measured hit rate ≥ 80% with the gate guarded (SC-001/SC-005).
5. US4 → differentiation demonstrated (SC-004).
6. US5 → regression gate + baselines (SC-005/SC-008).

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together.
2. Once Foundational is done: Developer A → US1, Developer B → US2, Developer C → US3.
3. US4/US5 follow (P2), then Polish.

---

## Completion Summary

- **Total tasks**: 43 (T001–T043).
- **Per story**: Setup 1 · Foundational 5 · US1 12 · US2 8 · US3 4 · US4 5 · US5 3 · Polish 5.
- **Parallel opportunities**: 16 tasks marked [P] across phases; three P1 stories run
  concurrently after Phase 2.
- **Independent test per story**: US1 — rubric floor + degradation suite
  (`tests/evaluation/reference-pack.test.ts`); US2 — traceability invariant
  (`tests/evaluation/traceability.test.ts`) + claim-audit pipeline tests; US3 — hit-rate harness
  + guard test; US4 — personalisation unit tests + `tests/evaluation/differentiation.test.ts`;
  US5 — baseline regression + degradation audit.
- **Suggested MVP scope**: User Story 1 (script quality) on top of Phase 1 + Phase 2.
- **Format validation**: every task is a checkbox with a sequential ID (T001…), optional [P],
  required [Story] label inside story phases, and exact file path(s).

## Notes

- [P] tasks = different files, no dependencies (see the shared-file sequencing table for the
  exceptions).
- [Story] label maps the task to the user story for traceability; Setup/Foundational/Polish carry
  no label.
- Each user story is independently completable and testable; verify tests fail before
  implementing.
- The validation gate (`findPlanViolations`) is never weakened — the guard test (T028) and the
  harness (T027/T029) are the evidence (FR-013/FR-015).
- Commit after each task or logical group; stop at any checkpoint to validate the story
  independently.
- Avoid: vague tasks, same-file conflicts (see sequencing table), cross-story dependencies that
  break independence.

---

## Phase 9: Convergence

**Input**: `/speckit-converge` assessment of the shipped implementation (commits 8610f99…1219947)
against [spec.md](spec.md), [plan.md](plan.md) and this task list. Full gate at the time of the
assessment: `pnpm verify` → 573 passed | 26 skipped. Five partial gaps remain; none are
constitution violations (constitution is an unfilled template). T046/T047 require the live
provider key (AGENTS.md §5 human approval gate) — the harnesses and tests are already in place,
only the paid run and recorded evidence are missing.

- [ ] T044 Update the `generateLesson` instruction in `apps/worker/src/pipeline/compile.ts`
      (lines 892–906) to demand the four structural elements — concrete opening, one idea per
      segment, a worked example worked inside the script, and a checkpoint via `pausePrompts` —
      so live-mode generation targets the `human_sounding` contract on the first pass rather than
      relying on verify-and-repair alone, per FR-007 / T017 (partial)
- [ ] T045 Run the live hit-rate harness across the reference pack
      (`GAPOS_PROVIDER_MODE=live pnpm exec tsx scripts/measure-plan-hit-rate.ts`) and iterate the
      `planCurriculum` instruction until the first-attempt valid-plan rate reaches ≥ 80%, keeping
      `tests/evaluation/plan-gate-guard.test.ts` green; record the command + result in
      `tasks/status.json` per SC-001 / FR-013 / FR-022 (partial; human approval gate)
- [ ] T046 Drive the review-due list from the learner's mastery evidence: compute `reviewDue`
      from evidence records (e.g. `uow.mastery.listEvidenceForCurriculum`) in the compile
      threading (`apps/worker/src/pipeline/compile.ts` currently hardcodes `reviewDue: []` at line
      368) so `derivePlanInputs` schedules review inside the new curriculum, per FR-020 /
      data-model.md "review-due list (FR-020)" (partial)
- [ ] T047 Re-record the live evaluation baselines including `human_sounding` via
      `scripts/record-eval-baselines.ts` (paid, deliberate review-gated flow; merge, never silent
      overwrite) so `tests/evaluation/live-provider.test.ts`'s no-regression check covers the new
      dimension on every live fixture — currently only eval_01's baseline carries
      `human_sounding` in `tasks/evaluation-baselines.json` per FR-021 / T037 (partial; human
      approval gate)
- [ ] T048 Record SC-007 p90 latency evidence (Day 1 < 3 minutes, full course < 10 minutes) on
      the reference workload from the existing `day_one_publication_latency_ms` /
      `full_course_publication_latency_ms` telemetry (`packages/observability/src/metrics.ts`,
      observed in `apps/worker/src/pipeline/compile.ts`), so the latency budget is a recorded,
      reproducible number per SC-007 (partial)

