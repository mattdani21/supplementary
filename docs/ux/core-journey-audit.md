# Arc core-journey UX audit

This is the running evidence log for GAP-033 through GAP-037. It separates behavior exercised in
the static founder prototype from behavior confirmed in application code. Implementation status
is updated after each browser pass.

## Test matrix

| Pass | Surface | Viewport | Input | Result |
| --- | --- | --- | --- | --- |
| P0 | Founder prototype | 400px mobile, 1280px desktop | Pointer; light/dark themes | Completed 2026-09-12 |
| P1 | Arc application | 375×812, 1440×900 | Keyboard and pointer; light/dark/reduced motion | Completed 2026-09-12 |
| P2 | Arc offline fallback | 375×812 | Browser offline mode | Completed 2026-09-12 |
| P3 | Live Arc application | 414×896, 1440×900 | Manual pointer/keyboard; light/dark | Completed 2026-09-12 |

## Findings

| ID | Route or screen | Evidence | Severity | Finding | Disposition |
| --- | --- | --- | --- | --- | --- |
| UX-001 | `/arc/calibrate` → setup → map | Browser and server tests | Blocker | Calibration created a draft with fixed constraints and no Arc source/compile step. | Fixed; confirmed constraints, source-only and explicit general-knowledge paths reach published Day 1. |
| UX-002 | `/arc` navigation | Browser test | Major | Prefix matching could mark Today and a nested primary tab active together. | Fixed; mobile and desktop assert exactly one `aria-current="page"`. |
| UX-003 | Skill map | Browser and code inspection | Major | Server `onClick`/`window` use and disabled objectives blocked semantic navigation. | Fixed; current/cleared objectives are links and later objectives explain their prerequisite. |
| UX-004 | Lesson tabs | Browser keyboard test | Major | The partial tab pattern lacked panels, relationships, roving focus, and arrow behavior. | Fixed; complete ARIA tab pattern and ArrowRight behavior pass. |
| UX-005 | Today reviews | Browser journey | Blocker | Due reviews were a dead count with no learner action. | Fixed; Today links to a server-graded queue with completion and next-review feedback. |
| UX-006 | Lesson practice | Browser and server tests | Blocker | Arc supported only code proofs and collected no confidence on conventional practice. | Fixed; hidden-answer multiple choice/free response, confidence, correction, and scheduling are covered. |
| UX-007 | Retention | Browser retention journey | Blocker | Filled capabilities were not reachable in Arc. | Fixed; a two-session filled gap is found through the Skills capability search. |
| UX-008 | Preferences | Browser and server tests | Major | `audioTheory` and `gentleHints` persisted without changing lesson behavior. | Fixed; default tab and hint visibility follow stored preferences; dark and spaced-review settings are visible behaviors. |
| UX-009 | Calibration baseline | Server test | Major | The client guessed correctness by option position. | Fixed; only the server/provider-validated kit grades the answer and the key never reaches the client. |
| UX-010 | Arc shell | Browser responsive pass | Major | The shell was a fixed phone column without desktop adaptation, safe areas, or route boundaries. | Fixed; 375×812 and 1440×900 passes cover responsive shell, loading, error, and not-found recovery. |
| UX-011 | Arc controls | Browser geometry test | Moderate | Several controls were below the 44px target contract. | Fixed; primary navigation and icon controls assert rendered dimensions. |
| UX-012 | First run and empty states | Browser test | Major | Today and Skills lacked intentional first-run recovery. | Fixed; first-run, empty search, all-cleared, no-practice, and no-source states have next actions. |
| UX-013 | Loading and network errors | Browser and code inspection | Major | Arc lacked consistent pending/error/retry treatment. | Fixed; shared status primitives cover source, compile, audio, practice, review, offline, partial, and failed states. |
| UX-014 | Skills search | Browser and server tests | Moderate | Search did not reach retained capabilities. | Fixed; server-backed capability search records only a `hasQuery` category, never query content. |
| UX-015 | PWA | Offline browser test | Major | The worker targeted legacy study behavior and did not explain unavailable signed audio. | Fixed with explicit boundary; visited text and shell are cached, writes fail clearly, and uncached cross-origin signed audio remains network-dependent by contract. |
| UX-016 | Theme and typography | Browser theme test | Moderate | Manifest colors followed the legacy theme and Inter lacked an explicit source. | Fixed; Arc manifest colors, packaged Inter, dark mode, and reduced-motion behavior pass. |
| UX-017 | Feedback language | Browser journey | Moderate | Arc lacked one correction/review pattern and legacy behavior revealed answers too early. | Fixed; answers remain hidden until server grading and misses use one supportive correction pattern. |
| UX-018 | Full browser acceptance | Repository gate | Blocker | No browser, accessibility, or route-journey acceptance suite existed. | Fixed; Playwright mobile/desktop, axe, keyboard, retention, and offline checks are part of `pnpm test:ui`. |

## Verification notes

- The mobile source-backed journey exercises calibration, setup, compile, real TTS controls,
  conventional practice, correction, preferences, due review, and Progress. A separate browser
  journey supplies two evidence sessions and finds the filled capability through search.
- Axe initially found insufficient contrast on setup field labels, practice options, and source
  policy labels. The colors were corrected rather than suppressing the rule; the rerun has no
  serious or critical violations.
- Live-app manual inspection used `http://127.0.0.1:3100` (not the static prototype) at mobile and
  desktop sizes. It confirmed the adaptive shell, one-active navigation, calibration constraints,
  setup route, and persisted dark mode. Exact 375px, keyboard tabs, reduced-motion, and offline
  behavior are additionally asserted by deterministic browser checks.
- Offline verification reloads a visited lesson, confirms its text remains, attempts a write and
  observes the actionable offline error, then confirms the safe uncached-navigation document.

## Prototype strengths to preserve

- One clear next action per populated screen.
- Calm paper/surface visual language with blue AI and mint verified signals.
- Progress is framed as proof rather than content consumption.
- Mobile bottom navigation, concise audio controls, transcript disclosure, and supportive misses.
- Dark mode and reduced-motion intent.

## Decision log

- Arc remains the learner surface; legacy `/gaps/*` pages are not visually redesigned.
- Browser assertions replace checked-in screenshot baselines because generated binary artefacts
  are prohibited in source control.
- No mastery threshold, review ladder, provider boundary, or status transition is changed by this
  overhaul.
- Textual lesson content is the offline fallback; cross-origin signed audio is explicitly
  network-dependent.
- The Next.js development tools portal can overlap mobile controls in development only. Keyboard
  activation is used for the required navigation check; the production build has no dev portal.

