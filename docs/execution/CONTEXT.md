# Source map and review context

| Area | Entry points |
| --- | --- |
| Product and architecture | `AGENTS.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/ARC-UI.md` |
| HTTP and viewer identity | `apps/web/src/app/api/helpers.ts`, `apps/web/src/server/api.ts`, `apps/web/src/lib/viewer.ts` |
| Server dependency assembly | `apps/web/src/server/bootstrap.ts`, `apps/web/src/server/context.ts` |
| Generation | `apps/worker/src/pipeline/compile.ts`, `apps/worker/src/daemon.ts`, `apps/worker/src/queue/worker.ts` |
| Queue persistence | `packages/database/src/repositories/jobs.ts` and `types.ts` |
| Notebook execution | `apps/worker/src/notebook/executor.ts`, `apps/web/src/server/services/arc-service.ts` |
| Contracts and boundaries | `packages/ai-contracts/`, `packages/domain/`, `packages/provider-adapters/`, `specs/` |
| Delivery state | `tasks/backlog.yaml`, `tasks/status.json`, `.github/workflows/ci.yml` |

## Findings

1. Root `Dockerfile`, `railway.json` and the audio proxy route exist. Older STATE claims that those files are missing are stale; their existence does not prove a successful deployment.
2. The Postgres branch of web bootstrap injects a Postgres unit of work but no Postgres job queue. `createServerContext` then supplies an in-memory queue. The worker uses its own durable queue: GAPX-01 verifies and repairs their shared wiring.
3. Identity comes from a caller-supplied `X-Owner-Id` header or unsigned `gapos_owner` cookie/default. Repository ownership tests do not establish that this caller identity is authentic.
4. Notebook proof code executes in a V8 context in the application process. Script time and output size are bounded, but the code does not establish independent process or memory containment. Public execution therefore needs the explicit decision and acceptance gate in GAPX-03.
5. Source review found no general request limiter in the shared HTTP adapter. GAPX-04 defines it without weakening per-run provider budgets.

## Commands

Root requires Node >=22 and the declared pnpm 10.33.0 toolchain. Fake mode is the normal test mode.

```bash
pnpm install --frozen-lockfile
GAPOS_PROVIDER_MODE=fake pnpm verify
pnpm --filter @gapos/web build
```

Postgres-specific suites require `GAPOS_TEST_DATABASE_URL`; S3 tests require the test storage configuration. Use ephemeral local services documented in `docs/OPERATIONS.md`, never a production database. Record every skip. Live-provider baselines require their separate opt-in and keys.

## Review limits

Source inspection covers the listed boundaries and existing tests, not every learner interaction or a hosted instance. Initial dependency installation downloaded packages but reported ignored esbuild/sharp build scripts; it was not a clean install pass. Test outcomes and environment blockers are recorded explicitly in the PR. This review did not use live AI providers.
