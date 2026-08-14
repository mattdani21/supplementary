# Data Model: Content Engine Quality (E24)

**Phase 1 output of `/speckit-plan`** | Branch `001-content-engine-epic` | 2026-08-14

Deltas only: the epic changes what the pipeline produces and how quality is measured. Entities
with no delta are listed with their existing home so traceability is explicit. All changes below
are additive; no existing column, floor, invariant or contract is weakened (FR-021).

## Entities

### User (extended — R7)

| Field | Type | Change | Notes |
|---|---|---|---|
| id / email / locale / timezone | existing | none | `packages/database/src/repositories/types.ts` |
| `preferredLessonLength` | `'short' \| 'standard' \| 'long'` (default `'standard'`) | **new** | FR-019 plan-shape input |
| `goals` | `string[]` (default `[]`) | **new** | FR-019 plan-shape input |

Persistence: forward-only migration `packages/database/src/migrations/006_learner_profile.sql`
(`ALTER TABLE users ADD COLUMN preferred_lesson_length … ADD COLUMN goals …`); both repository
implementations updated (`packages/database/src/repositories/memory.ts`, `postgres.ts`).
Validation: zod or type-level union; unknown values rejected by the repository layer.

### Gap (unchanged)

`title, rawStatement, currentState, targetCapability, successCondition, deadline, dailyMinutes,
sourcePolicy, status, assumptions` — `packages/database/src/repositories/types.ts`. Input 1 of
the personalization function. Status lifecycle untouched (`packages/domain/src/gap/state-machine.ts`).

### Source / SourceChunk (unchanged)

`packages/database/src/repositories/types.ts`, chunking in
`packages/domain/src/sources/chunking.ts`. Each chunk carries `locator` (human-meaningful
position). Input 2 of the personalization function; the spine every objective/lesson/question
traces to (FR-008). The injection scan keys on chunk ids
(`detectInjectionAttempts`, `packages/ai-contracts/src/evidence-envelope.ts`).

### Diagnostic (unchanged)

`DemonstratedCapabilities, knowledgeGaps, inferred, baselineConfidence,
recommendedStartingDifficulty` — `DiagnosticInterpretationContract`,
`packages/ai-contracts/src/contracts.ts`. Input 3 of the personalization function.

### LearnerProfile (new fields on User — R7)

Profile inputs: `goals`, `preferredLessonLength`; accessibility lives on the user surface
(locale/timezone) and is out of scope for plan shape. Consumed by `derivePlanInputs`
(`packages/domain/src/curriculum/personalisation.ts`, new) and rendered into `learnerBrief`
(`apps/worker/src/pipeline/compile.ts`). Input 4 of the personalization function.

### MasteryEvidence (unchanged, newly consumed)

`packages/database/src/repositories/types.ts` (`MasteryEvidenceRecord`; repo
`uow.mastery.listEvidenceForCurriculum`, `listEvidence`). Per-objective correctness, difficulty,
independence, evidence type (incl. `delayed_retrieval`), recency. Input 5 of the personalization
function: `derivePlanInputs` computes `satisfied` (recent, strong evidence → at most a Day-1
recall check, FR-018), `decayed` (stale → re-demonstrate, FR-018/FR-020), and a review-due list
(FR-020). The existing `classifyPriorCapabilities` (`packages/domain/src/mastery/mastery.ts`)
already distinguishes satisfied/decayed for filled gaps and stays the source of decay judgments.

### Curriculum / Objective (unchanged contract; plan is post-processed)

`CurriculumPlanContract` / `ObjectiveSchema`, `packages/ai-contracts/src/contracts.ts`. The
planner's output passes `personalisePlan` (new, deterministic) before storage; the adapted plan
is re-validated by `findPlanViolations` (`packages/domain/src/curriculum/plan-validation.ts`) so
adaptation can never ship an invalid plan (FR-013). The `plan_curriculum` generation step now
records `{ plan, attempts }` (R4).

### Lesson (unchanged contract; verified and scored)

`LessonPackageContract`, `packages/ai-contracts/src/contracts.ts`. Fields consumed by the
human-sounding rubric (R2): `script` (opening/segments), `examples` (worked example),
`pausePrompts` (checkpoint), `evidence` (locators). Verification:
`packages/domain/src/verification/verifier.ts` gains `checkLessonStructure` with category
`script_structure` (critical when an element is missing → repair/exclude before publication,
FR-007).

### Question (unchanged contract; scored, traced, shown)

`QuestionSchema`, `packages/ai-contracts/src/contracts.ts`. `evidence` is the traceability
carrier (FR-008); the study page renders locators before answering (SC-006).

### AuditFinding (extended categories)

`packages/database/src/repositories/types.ts`:
`category: string` (free-form; new values `unsupported_claim`, `script_structure`, and the
existing `prompt_injection`, `objective_coverage`, …),
`severity`, `finding`, `repairStatus: 'open' | 'repaired' | 'excluded' | 'accepted'` (the
recorded resolution: removed → `excluded`, repaired → `repaired`, labelled → `accepted`,
FR-009), `repairAttempts`. No schema change needed (category is already a string).

### GenerationRun / GenerationStep (output-shape change + one new step)

`packages/database/src/repositories/types.ts`, state machine
`packages/domain/src/generation/state-machine.ts`:
- `plan_curriculum` step output becomes `{ plan, attempts }` (R4); `PIPELINE_VERSION` → `1.1.0`
  (`apps/worker/src/pipeline/compile.ts`).
- New step name `audit_claims` added to `GENERATION_STEPS` (R8), executed inside the `auditing`
  stage; input version `hash(lesson)` keeps it idempotent.

### EvaluationFixture / Scorecard / Baseline (new dimension + rubric)

`packages/evaluation/src/fixture.ts`, `scorer.ts`, `baseline.ts`:
- `SCORE_DIMENSIONS` gains `'human_sounding'`; `SCORE_FLOORS` gains its floor (calibrated from
  reference curricula, R10); `scoreHumanSounding` added to `scorer.ts` (R1/R2).
- New published rubric: `packages/evaluation/HUMAN_SOUNDING_RUBRIC.md`.
- Baselines: `tasks/evaluation-baselines.json` (recorded via `scripts/record-eval-baselines.ts`).

## Relationships

```text
User 1─* Gap 1─* Source 1─* SourceChunk (locator)
  │            └─* Curriculum 1─* Lesson 1─* Question
  │                └─* Objective (evidence → SourceChunk)
  ├─* Diagnostic (per gap)
  └─* MasteryEvidence (per objective) ──► personalisePlan inputs
GenerationRun 1─* GenerationStep (plan_curriculum {plan, attempts}; audit_claims)
               └─* AuditFinding (category, repairStatus = resolution)
EvaluationFixture 1─* Scorecard (dimensions incl. human_sounding) ─► Baseline
```

## Validation rules (unchanged or additive)

- A source-grounded item with no locator is refused (contract `EvidenceSchema.refine`,
  `plan-validation.ts`, verifier `source_support`) — unchanged, now also asserted by
  `assertTraceability` (FR-008).
- A plan violating time budget / coverage / prerequisite integrity / evidence grounding is
  rejected with every violation returned together — unchanged (`findPlanViolations`), guarded by
  the new guard test (FR-015).
- A lesson script missing a structural element is repaired or excluded, never shipped —
  **new**: `script_structure` critical findings (FR-007).
- An unsupported claim with no recorded resolution blocks publication — **new**:
  `claim_audit` findings (FR-009).
- An item citing an injected chunk is refused — **new**: verifier rejects evidence locators that
  point at chunks flagged by `detectInjectionAttempts` (FR-010; `injectionSignals` already flow
  into `VerificationContext`).
- A personalized plan must still be valid — **new**: `personalisePlan` output re-runs
  `findPlanViolations` before storage (FR-013).

## State transitions

None new. Generation statuses (`queued → … → auditing → repairing | synthesising_audio →
publishing → complete | partial`, `failed`, `cancelled`) are untouched; `audit_claims` is a step
inside the existing `auditing` stage, and the existing `repairing → auditing` cycle is what
enforces "unsupported claim resolved before publication" (R8).
