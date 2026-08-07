# Goal

Launch GapOS publicly and get real learners completing verified audio courses

## Roadmap

### M1 — Deployable single-node (close issue #6)
- [x] Root Dockerfile that builds and runs apps/web + apps/worker
- [x] railway.json (or equivalent) with healthcheck; deployment boots with env config only
- [x] Audio proxy / no-S3 storage path so artefacts serve without MinIO (issue #6)
- [x] Verify the OPERATIONS.md deployment surface from a fresh checkout (GAP-026)
*Definition of done:* issue #6 closed; a fresh deployment boots with env config only and serves a compiled course with audio.

### M2 — Live-mode production hardening
- [ ] Live provider smoke against recorded baselines (tests/evaluation/live-provider.test.ts vs GAP-014b evidence in tasks/status.json)
- [ ] Verify budgets on live runs (GAPOS_BUDGET_PER_RUN_MILLICENTS / GAPOS_BUDGET_DAILY_MILLICENTS) degrade to text-only instead of overspending (GAP-015)
- [ ] Worker daemon deployed alongside web with graceful SIGTERM shutdown (GAP-020)
- [ ] Telemetry + cost accounting for every stage (packages/observability)
*Definition of done:* a live compile completes within budget and scores at or above the recorded baselines (eval_02–10, 9/9 PASS in GAP-014b).

### M3 — Public multi-user launch surface
- [ ] Real authentication replacing the X-Owner-Id header (deferred in GAP-021 out_of_scope)
- [ ] Rate limiting on API endpoints (deferred in GAP-021 out_of_scope)
- [ ] Landing page + signup; privacy policy and terms
- [ ] Domain + SSL; production env config on the M1 deployment
*Definition of done:* a new learner can sign up and start a gap without manual setup, with identity and rate limits enforced.

### M4 — First real learners complete verified courses
- [ ] Recruit a pilot cohort of real learners
- [ ] Track completion + mastery metrics (gaps filled on evidence per GAP-012, courses completed, audio listened)
- [ ] In-app feedback loop → tracked issues
- [ ] Fix the top pilot friction, recorded with evidence in tasks/status.json
*Definition of done:* at least 5 learners complete a 7-day course and fill a gap on verified mastery evidence, not consumption.

### M5 — Retention and verification loops
- [ ] Review ladder retention (remediation items, re-verification) with repeat learners (GAP-012)
- [ ] Scheduled evaluation pack re-runs against baselines (GAP-014 / GAP-014b)
- [ ] PWA offline lesson verified on device (E14 / GAP-022)
- [ ] Capability library as a growth surface: filled gaps searchable and reusable (GAP-013)
*Definition of done:* repeat learners exist; evaluation regressions fail the build; the offline lesson works after first load.
