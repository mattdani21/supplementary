# ARC UI — founder spec (2026-08-30)

GapOS consumer surface, codename **Arc**. Tagline: *Learn the gap. Prove the skill.*

Visual spec: `docs/prototypes/arc-skill-learning-prototype.html` — a static, fully
clickable demo of the target UX (open it in a browser; it is the UI contract).

## What the product is

Adaptive learning by proof. The learner picks a direction, a 3-step AI calibration
finds what actually matters, and each gap in the resulting map is cleared by
**listening to short audio theory + completing a notebook proof** — progress is
earned through demonstrated evidence, never passive consumption.

## Screens (must exist in apps/web)

1. **Today** — greeting, daily-focus progress, Continue card (current gap), "Your
   map" card with progress ring, Keep-exploring suggestions, momentum dots.
2. **Skills** — library with search, add-skill panel (subject chips → start
   calibration), per-skill gap count + status.
3. **AI calibration** — 3 steps: subject → goal ("useful" looks like…) → baseline
   code question (adaptive placement, no self-reported confidence) → mapping
   animation → result: N gaps identified with a next/after/later preview.
4. **Skill map** — progress ring, next-gap hero card (gap title, ETA, start proof),
   vertical sequence of gaps with cleared / current / later states.
5. **Lesson** — theory tab (audio player: play/pause, waveform, ±15s skip, 1×/1.25×/1.5×,
   transcript drawer; short theory text; listen-for note) + notebook tab (editable
   code cell, hint, run cell → output, submit proof).
6. **Progress** — proofs ledger (gaps cleared with dates), weekly focus stat,
   momentum.
7. **Profile** — learning preferences: audio theory, gentle hints, dark mode,
   spaced review.

Design language: calm and minimal; paper/surface/line tokens; **blue = AI signal**,
**mint = cleared/verified**, amber = notes, coral accent; dark + light themes; radii
12–27px; Inter; visible focus rings; `prefers-reduced-motion` support; aria labels.
The device frame / status bar / iOS-Android chrome in the prototype is demo dressing —
the app itself must be responsive without it.

## REAL, not demo — the prototype's JS is static demo logic and must NOT survive

1. **Notebook proof = REAL server-side code execution** (sandboxed route, apps/worker),
   validated against the independent verifier (GAP-010). No regex check on source text.
   A correct proof records an attempt + advances gap state; a wrong one shows a
   supportive failure and changes nothing.
2. **Audio = REAL synthesized TTS** from the compile pipeline (GAP-011). Player drives
   real playback (play/pause, skip, rate, transcript sync).
3. **Calibration = REAL adaptive placement** — subject → goal → baseline question from
   the evaluation pack, routed through provider adapters (GAP-029); result comes from
   the knowledge map (E15) + curriculum planning.
4. **Gap cleared / proofs ledger = real attempt + mastery evidence** (GAP-012), and the
   proof list reads mastery records.
5. **Spaced review toggle = real review scheduling** (GAP-012/GAP-013), not a dead switch.
6. **Continue card, progress ring, momentum = real domain data** from the API.

## Acceptance criteria (gate)

- All screens implemented in apps/web (Next.js), responsive, matching the prototype's
  design language; the vertical slice from AGENTS.md §1 keeps working.
- Run cell executes code server-side; correct proof records an attempt and advances
  the gap state machine; wrong answer is supportive and state-neutral.
- Audio player plays the compiled lesson's real TTS URL; controls work.
- Calibration flow persists selections and maps to real gaps.
- Map / progress reflect real DB state (gap statuses, cleared proofs).
- `pnpm verify` green; no weakened tests; new tests cover real execution + state
  transitions + persistence round-trips.

## Constraints

- AGENTS.md non-negotiables: domain purity, provider adapters only, schema-validated
  contracts before persistence, status only via the state machine, idempotent
  generation, evidence-never-instruction, no generated binaries in source control.
- No new paid services; reuse `packages/*` and the existing apps/worker daemon.
- Owner cookie pitfall: the web viewer's owner default must equal the CLI's
  (`local-learner`) or seeded data is invisible in the app.
- Local dev: reuse the running local Postgres via `GAPOS_DATABASE_URL`; do NOT
  start/stop docker or brew services.

## Execution

- Controller loop per AGENTS.md §3, task `GAP-032` in `tasks/backlog.yaml`.
- Commit coherent progress every 20–30 min; up to 500 iterations if needed.
- Record evidence in `tasks/status.json` under GAP-032; never push.
