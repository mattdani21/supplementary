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

## Human gate

Recruiting five real learners is not an agent task. The automated rehearsal
(`tests/end-to-end/pilot-rehearsal.test.ts`) proves five isolated synthetic owners can fill a
gap. It does not substitute for the M4 cohort.

## After the cohort

Unrestricted public launch remains a separate approval (AGENTS.md §5).
