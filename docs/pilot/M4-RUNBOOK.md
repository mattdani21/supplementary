# GOAL M4 pilot runbook

Exit evidence: at least five learners finish the defined course/mastery journey. A rendered
screen or a generated lesson alone does not count.

## Preconditions

- GAPX-01–04 recorded `done` with commands in `tasks/status.json`
- Staging restart journey passed (or recorded `not_run` with the missing env named)
- Live-provider evaluation run against the **exact** production model, or recorded `not_run`
  because keys were absent (human gate)
- `GAPOS_IDENTITY_MODE=protected`, `AUTH_SECRET`, invite list, explicit `GAPOS_QUOTA_*`
- `GAPOS_PROOF_EXECUTION=local` only on this invited private instance
- Deploy order: migrations → worker → web → `pnpm tsx scripts/smoke-compile.ts`

## During the pilot

Track, without logging user content or prompts:

- gaps filled on evidence
- courses completed
- audio listened (artefact play events already in storage access)
- top friction → GitHub issues + a note in `tasks/status.json`

## Cohort

The private-beta learners are five named agents in
`apps/web/src/server/pilot/agent-learners.ts`. They are not a public signup list.

```bash
pnpm tsx scripts/run-agent-cohort.ts
```

A DeepSeek production-model smoke (one compile, key from the environment only):

```bash
GAPOS_PROVIDER_MODE=live GAPOS_LLM_API_KEY=… pnpm tsx scripts/live-deepseek-smoke.ts
```

Do not commit the key. Public launch remains a separate approval.

## After the cohort

Unrestricted public launch remains a separate approval (AGENTS.md §5).
