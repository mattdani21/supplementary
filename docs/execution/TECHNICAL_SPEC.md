# Technical specification

## Existing contract boundaries

Keep `specs/openapi.yaml` and generated schemas synchronized for any HTTP change. Domain owns gap transitions and mastery rules; repository methods always receive `OwnerId`. Provider outputs are validated before persistence. The queue's cross-owner `claimDue` operation is worker infrastructure; reads, enqueue, complete and fail remain owner-scoped.

## GAPX-01: web and worker queue

In Postgres mode, `getServerContext()` constructs a single pool and injects both `createPostgresUnitOfWork(pool)` and `createPostgresJobQueue(pool)` into `createServerContext`. The no-database local path retains the existing memory implementations. The worker reads the same configured database/schema. Use the existing queue and migration, not a new broker.

At the HTTP compile boundary, a successful enqueue returns the existing response and durable job identity. A separately constructed queue/worker sees that job without sharing memory with the web context. After closing and rebuilding the web context, the pending job remains discoverable. Failure to enqueue must surface an error and not report successful scheduling. Preserve existing retry/idempotency rules; do not claim exactly-once external provider charging merely because queue leasing exists.

Test with a synthetic owner, gap and source, an ephemeral Postgres database, separately constructed web/worker contexts and fake providers. Verify state and artefact persistence after one job. Keep the in-memory journey as fast complementary coverage.

## GAPX-02: trusted session adapter

Introduce a server-only identity port `resolveOwner(request): Promise<OwnerId>` behind the shared HTTP adapter and server-rendered viewer resolver. Protected mode receives identity only from an injected session verifier. The verifier validates signature/session authenticity, issuer/audience where applicable, expiry and the server-side subject-to-owner mapping. Provider/library selection is a separate recorded decision; no signing or session system is invented in the domain package.

Missing, expired or invalid session is 401. A valid owner attempting another owner's resource receives the existing non-disclosing not-found/forbidden semantics. `X-Owner-Id`, body owner fields and `gapos_owner` cannot override a verified subject. A signed-in request carrying conflicting identity hints is rejected before data access. Local demo mode remains explicit and cannot be selected merely because a protected configuration is incomplete. Production boot without the verifier fails; protected mode has no local-learner fallback.

Apply the resolver consistently to JSON routes, audio/source access, server-rendered pages and Arc routes. Public health can remain unauthenticated. Use two deterministic fake identities in tests; those prove the port and ownership behavior, not the selected identity provider's integration.

## GAPX-03: proof execution boundary

Preparation contract: add an explicit deployment capability flag defaulting to disabled for server-side notebook execution in shared/public mode. A disabled proof-run request returns 503 with typed error code `proof_execution_unavailable` and performs zero executor calls; reading saved lessons/proofs remains available. Document this response in OpenAPI. Local synthetic development may explicitly enable the existing implementation; do not label it a public isolation guarantee.

The subsequent isolation implementation is blocked on an ADR selecting a deployment-supported boundary. Its required interface accepts code plus verifier checks and returns the existing `CellExecution` shape. Required properties: independent process/container or equivalently reviewed isolation, no host secrets, no network, no writable host mounts, bounded CPU/wall time, memory and output, termination on timeout, and cleanup after failure. Tests include nontermination, allocation exhaustion, host access attempts and concurrent jobs. These are bounded synthetic cases, not exploit code for an external service. This specification sets acceptance requirements; it does not approve a sandbox provider or architecture change.

## GAPX-04: request quota

Add a server-side limiter port with an atomic check keyed by authenticated owner and operation class. Apply separate configurable limits for uploads, compile requests and proof runs; choose actual quota values as deployment configuration, with validated positive limits/window duration. Protected mode requires explicit values and a shared limiter implementation. Memory limits are development-only; a shared deployment uses a reviewed atomic store already in the stack.

A request that would exceed the limit returns 429 with integer `Retry-After` seconds (ceiling of time to reset, minimum 1) and a typed `rate_limited` error. It causes no upload write, queue enqueue, proof execution or provider call. Count authenticated attempts, including downstream failures, until window expiry to prevent failure-based bypass. Concurrent requests cannot admit more than the configured quota. Different owners have independent counters. Authentication failures do not consume another owner's quota. Per-provider budgets remain separate controls.

## Integration and rollback

Use additive forward-only migrations if storage is required. Record rollout defaults and degraded behavior in OPERATIONS and `.env.example`. Do not re-enable forged identity or public in-process proof execution to recover a failing release; a release can remain private while the new gates are repaired. Preserve existing task/evaluation evidence and the original automated acceptance tests.
