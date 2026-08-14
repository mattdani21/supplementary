# QUALITY SPEC — the taste contract

> Status: v1 (Aug 2026). This is the definition of "feels as quality as Duolingo or Brilliant"
> for GapOS. It is a **contract**: every item below is either enforced by a test/lint rule or
> named as an acceptance criterion in a backlog task. If it is not checkable, it is not in this
> spec. Quality is not a vibe; it is a checklist with teeth.

## 1. Principle

GapOS is a *personal fabrication* product: curriculum = f(gap, sources, diagnostic, learner
profile, mastery evidence). The quality bar is set by consumer learning products (Duolingo,
Brilliant) **on feel**, and by the evaluation pack **on substance**. A user should never feel
like they are operating a developer tool — including the first time, the fiftieth time, and
the moment something goes wrong.

## 2. Non-negotiable interaction states

Every interactive element (button, link, input, tab, segmented control, summary) MUST have all
of these, enforced by the shared CSS tokens:

- `:hover` — visible response (surface lift or border brighten), ~120ms
- `:active` / pressed — scale or brightness dip (motion token `--press`), ~80ms
- `:focus-visible` — 2px accent ring with 2px offset, never removed
- `:disabled` — 45% opacity + `not-allowed` cursor, no hover response
- `[aria-current]` — accent-tinted (tab bar does this)

Rule: no interactive element may rely on color alone to signal state (WCAG 1.4.1).

## 3. Feedback moments (the "felt" layer)

- **Every user action has a visible consequence within 150ms** (button state, optimistic UI,
  or a loading surface — never a dead click).
- **Correct practice answer** → positive feedback (accent flash / check) within 200ms, then the
  verified-solution reveal. No confetti for routine items; reserve celebration for milestones.
- **Incorrect answer** → correction surface that *shows the verified solution and the source
  link*, framed as repair not failure (no red-heavy alarm).
- **Confidence capture** is a single tap (low/medium/high as segmented control), not a form.
- **Compile / generation in progress** → a designed progress surface: phase label, step list
  with per-step status (queued/running/succeeded/failed), estimated remaining, and a cancel.
  The raw generation log is never the user-facing surface — it is the debugging view.

## 4. Empty states are designed, never blank

Every list surface (tracks, sources, practice items, review queue, knowledge map) has a crafted
empty state: one-line explanation of what belongs here, a concrete next action, and the same
voice as onboarding. Empty states teach the product.

## 5. Onboarding and first run

- First visit: a 3-step guided flow — (1) name one gap you want to close, (2) upload or point
  at a source, (3) set daily minutes. Then compile starts immediately so the first reward
  (Day 1 audio) arrives fast.
- The home surface ("Today") is never empty after onboarding; it shows the compile-in-progress
  surface until Day 1 lands.
- Skip is always available; the app must be usable without onboarding.

## 6. Motion and rhythm

- Motion tokens only (no ad-hoc durations): `--duration-fast: 120ms`, `--duration-base: 200ms`,
  `--duration-slow: 320ms`; easing `--ease-out` (cubic-bezier(0.2, 0, 0, 1)) for entrances,
  `--ease-spring` for feedback pops.
- Page transitions: fade+8px slide, `prefers-reduced-motion` → zero animation (already present).
- No element animates for longer than 500ms except progress/loading indicators.
- Scrollbar styling matches the theme (thin, hairline).

## 7. Typography and spacing

- Type scale is token-driven (`--text-xs` … `--text-3xl`), 1.4–1.6 line height, tracking tuned
  per size (headings slightly tight, body normal).
- Spacing scale (`--space-1` … `--space-8`) — no ad-hoc margins/paddings in components.
- Long-form content (transcripts, lessons) uses a readable measure: max 68ch, comfortable
  leading, no justified text.

## 8. The audio experience (the product is audio-first)

- Player: play/pause, seek, **playback speed (0.75/1/1.25/1.5/2)**, segment skip, and a progress
  bar that never stutters.
- Transcript: always present, scroll-synced to playback when playing, tap-to-seek.
- Audio failures (401/missing) show a designed fallback: "Audio unavailable — text below" +
  the transcript, never a repeated raw error string.
- Duration estimates shown before play (Day card, lesson header).

## 9. Accessibility floor

- Full keyboard operability (tab order matches visual order, no traps).
- Landmarks: header/nav/main/region per screen; tab bar is a `<nav aria-label>`.
- Color contrast ≥ 4.5:1 for text, ≥ 3:1 for UI components (WCAG AA).
- `prefers-reduced-motion` honored globally.
- Form labels always visible (never placeholder-only).

## 10. Content quality (the substance layer)

- Every published lesson has: audio + transcript + at least 2 retrieval + 1 application item,
  each with a **verified solution** (evaluation-pack graded) and source links (invariant tests
  already assert this — it is the floor, not the ceiling).
- Lesson scripts read like a human teacher, not a model dump: concrete opening, one idea per
  segment, worked example, checkpoint question. A "human-sounding" rubric lives in
  `packages/evaluation` (published at `packages/evaluation/HUMAN_SOUNDING_RUBRIC.md`), is scored
  against reference packs, and is enforced by the `script_structure` verifier before publication.
- Sources are the curriculum's spine: every objective traces to a source locator; unsupported
  claims are removed/repaired/labelled (existing invariant).
- The planner refuses invalid curricula (already true — TOPIK's failed compile is the gate
  working). Content tasks improve the *hit rate* of valid, high-quality plans, not the gate.

## 11. What is explicitly out of scope for v1

- Illustration/character art (Duolingo-style mascots) — motion and typography carry the feel.
- Gamification (streaks/XP) — habit layer comes after quality + content (roadmap Phase 1).
- Social/leaderboards.

## 12. Enforcement

| Item | Enforcement |
|---|---|
| Tokens exist + no hardcoded legacy colors | lint rule (grep-block on `#0f172a`, `slate-`…) |
| Focus-visible everywhere | component test iterating interactive elements |
| Empty states present | render test per list surface |
| Audio fallback designed | render test on 401 path |
| Motion respects reduced-motion | CSS + test on the transition class |
| Contrast AA | token choices are AA by construction (documented pairs) |
| Speed controls | component test on audio-player |
| Content invariants | existing invariant test suite (extends, never weakens) |
| Human-sounding rubric (E24 US1/US5) | `human_sounding` floor + 4 degradation cases in `tests/evaluation/reference-pack.test.ts`; regression gate compares against `tasks/evaluation-baselines.json` on every verify |
| Traceability (E24 US2) | invariant on the compiled reference curriculum (`tests/evaluation/traceability.test.ts`); claim audit + source links covered by pipeline and render tests |

A screen is "quality-done" when: all interactive states exist, all empty states are designed,
feedback moments are present, a11y passes, and no legacy tokens remain. That is the Definition
of Done for every quality backlog task.
