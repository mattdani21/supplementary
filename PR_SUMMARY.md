# M1.4: Fresh-checkout verification of the deployment surface (GAP-026)

## What
Verified the OPERATIONS.md deployment surface from a completely fresh checkout of `main`, and made the smoke step executable + the docs honest.

## Why
M1's DoD needs the documented surface proven from zero. Items 1-3 (Dockerfile, railway.json, audio proxy) shipped in PR #6; this closes the verification item and fixes two documentation claims the verification disproved.

## How tested
From a clean clone (`/tmp/gapos-fresh`, `git clone` of `main`):

| Check | Command | Result |
| --- | --- | --- |
| One-command install | `pnpm install` | Done (cached store) |
| Quality gate | `pnpm verify` | **400 passed \| 26 loud skips** |
| Web boots env-only | `pnpm --filter @gapos/web start` (no env) | `/api/health` 200 with `X-Owner-Id`; loud in-memory warning logged |
| Worker graceful shutdown | `pnpm --filter @gapos/worker start` + SIGTERM | `"gapos-worker stopped cleanly"`, exit 0 |
| Full journey, no-S3 path | `pnpm tsx scripts/smoke-compile.ts` (new) | `SMOKE OK: published course, 3 lessons, audio/mpeg (43 bytes)` |

## Findings fixed in this PR
1. **`scripts/smoke-compile.ts`** — new executable smoke compilation (release strategy step 4 now names it). Runs gap → source → define → compile → lessons → audio bytes with no keys, no DB, no S3.
2. **OPERATIONS.md no-S3 claim was wrong for the deployed topology**: in-memory repositories/storage are per-process, so a no-S3/no-Postgres trial only works as a single process (web + worker as separate services cannot share either). Corrected with the single-process requirement.
3. **GOAL.md M1 items checked off** (items 1-3 shipped in #6; item 4 by this PR). M1's DoD (a *deployed* instance) still needs the owner-gated Railway step.

## Notes
- The verification also surfaced the session-environment pitfall: a leaked `GAPOS_TEST_DATABASE_URL` makes the Postgres suites run instead of skip — the fresh checkout must be clean-env.
