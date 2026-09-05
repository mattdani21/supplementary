# Bounded work packets

These are proposed implementation tickets, not claims of completed work. `Ready` means sufficiently specified to begin local work. `Blocked` names an unmet dependency or decision. Historical task ledgers retain completed-task evidence.

## GAPX-01 — Connect the web API to the durable worker queue

**Readiness:** Ready. **Depends on:** None; reassess overlap with PR #15. **Parent goal:** GOAL M1/M2 deployment journey.

**Outcome:** A job accepted by the web process is consumable by the separate worker.

**Read:** `apps/web/src/server/bootstrap.ts`, `context.ts`, `apps/worker/src/daemon.ts`, `packages/database/src/repositories/jobs.ts`.

**Implementation ownership:** Web bootstrap plus narrowly required dependency wiring; native task status when executing.

**Verifier ownership:** New bootstrap integration test under `tests/end-to-end/`; existing worker/journey suites.

**Contract:** TECHNICAL_SPEC GAPX-01.

**Acceptance criteria:**

1. **AC1:** Postgres web context and a separately built worker observe the same enqueued job.
2. **AC2:** Closing and recreating the web context preserves pending work; fake-provider completion persists expected artefacts.
3. **AC3:** Queue failure is not reported as successful scheduling; the memory-only journey still passes.

**Verification:** `pnpm test tests/end-to-end/postgres-worker.test.ts` plus the new bootstrap test with GAPOS_TEST_DATABASE_URL; `pnpm verify`.

**Non-goals:** New broker, payment accounting redesign, live-provider calls.

**Failure/rollback:** Revert wiring on the feature branch; preserve queued records and migrations.

## GAPX-02 — Introduce and verify the trusted identity boundary

**Readiness:** Port and fake tests ready; provider integration blocked on recorded choice. **Depends on:** Identity adapter/provider decision before protected launch. **Parent goal:** GOAL M3 real authentication.

**Outcome:** Only server-verified identity chooses the owner of a request.

**Read:** `apps/web/src/app/api/helpers.ts`, `apps/web/src/server/api.ts`, `apps/web/src/lib/viewer.ts`, `docs/SECURITY.md`.

**Implementation ownership:** Shared HTTP/viewer resolvers, new server-only identity adapter, affected route/client glue, OpenAPI.

**Verifier ownership:** Two-owner tests in `apps/web/src/server/` and `tests/end-to-end/security.test.ts`.

**Contract:** TECHNICAL_SPEC GAPX-02.

**Acceptance criteria:**

1. **AC1:** Forged headers/cookies cannot switch a verified owner; conflicts are rejected without data access.
2. **AC2:** Expired/missing session returns 401 and protected boot without a verifier fails.
3. **AC3:** All protected routes/pages/audio use the same identity port; two-owner isolation passes.

**Verification:** New identity tests, existing API/Arc/security suites, `pnpm verify`; chosen-provider integration separately recorded.

**Non-goals:** Invented identity provider, public signup deployment, user-data migration.

**Failure/rollback:** Keep deployment private if session integration fails; no automatic demo fallback.

## GAPX-03 — Make the public notebook execution gate explicit

**Readiness:** Disable-by-default capability ready; new sandbox blocked on architecture decision. **Depends on:** ADR and supported isolation environment for later execution implementation. **Parent goal:** GOAL M3 safe multi-user capability.

**Outcome:** Shared mode cannot silently run learner code inside the application process.

**Read:** `apps/worker/src/notebook/executor.ts`, `apps/web/src/server/services/arc-service.ts`, proof API route and `specs/openapi.yaml`.

**Implementation ownership:** Capability configuration and proof-run boundary; new sandbox ADR proposal; OpenAPI and operations docs.

**Verifier ownership:** Proof API refusal tests; later isolated executor contract fixtures.

**Contract:** TECHNICAL_SPEC GAPX-03.

**Acceptance criteria:**

1. **AC1:** Disabled capability returns the specified 503 error and invokes no executor.
2. **AC2:** Saved learning content remains readable; explicit local development mode remains testable.
3. **AC3:** Isolation acceptance matrix is recorded; implementation is not called complete before memory/network/timeout containment tests pass.

**Verification:** Proof API and notebook tests plus `pnpm verify`; isolated backend tests remain not_run until an architecture is selected.

**Non-goals:** Choosing a new execution service without review, changing mastery criteria.

**Failure/rollback:** Leave the capability disabled if isolation cannot be demonstrated.

## GAPX-04 — Limit authenticated upload, compile and proof requests

**Readiness:** Local port/tests ready; shared integration depends on GAPX-02. **Depends on:** GAPX-02; configuration of shared atomic limiter. **Parent goal:** GOAL M3 request limits.

**Outcome:** Concurrent requests cannot exceed the configured owner quota or cause rejected side effects.

**Read:** Shared API helper, compile/source/proof handlers, existing error mapping and OPERATIONS.

**Implementation ownership:** New limiter port/adapter, shared route glue, `.env.example`, OpenAPI and any additive storage migration.

**Verifier ownership:** Fake-clock/concurrency and side-effect-count tests in API/security suites.

**Contract:** TECHNICAL_SPEC GAPX-04.

**Acceptance criteria:**

1. **AC1:** N concurrent requests admit at most the configured limit; owners are independent.
2. **AC2:** Rejected requests return 429 and correct Retry-After, with zero downstream side effects.
3. **AC3:** A downstream failure still consumes an admitted attempt; counters reset at the configured boundary.

**Verification:** Limiter tests, API/security suites and `pnpm verify`; shared-store concurrency test before public integration.

**Non-goals:** Replacing provider budgets, arbitrary hardcoded quotas, paid infrastructure.

**Failure/rollback:** Keep shared entry points unavailable if the configured limiter cannot operate.
