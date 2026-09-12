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
| P4 | Refusal and privacy audit | Server boundaries and 375×812 offline browser | Independent probes | Completed 2026-09-12 |

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
| UX-009 | Calibration baseline | Server test | Major | The client guessed correctness by option position. | Fixed; an opaque kit ID binds submission to the displayed, server-held answer key and the key never reaches the client. |
| UX-010 | Arc shell | Browser responsive pass | Major | The shell was a fixed phone column without desktop adaptation, safe areas, or route boundaries. | Fixed; 375×812 and 1440×900 passes cover responsive shell, loading, error, and not-found recovery. |
| UX-011 | Arc controls | 375×812 and 1440×900 browser geometry | Moderate | Several controls were below the 44px target contract. | Fixed; navigation, icon, lesson tab, play, skip, rate, and transcript controls assert rendered dimensions. Calibration headings receive focus after each client-side step. |
| UX-012 | First run and empty states | Browser test | Major | Today and Skills lacked intentional first-run recovery. | Fixed; first-run, empty search, all-cleared, no-practice, and no-source states have next actions. |
| UX-013 | Loading and network errors | Browser and code inspection | Major | Arc lacked consistent pending/error/retry treatment. | Fixed; shared status primitives cover source, compile, audio, practice, review, offline, partial, and failed states. |
| UX-014 | Skills search | Browser and server tests | Moderate | Search did not reach retained capabilities. | Fixed; server-backed capability search records only a `hasQuery` category, never query content. |
| UX-015 | PWA | 375×812 offline browser test | Major | The worker targeted legacy study behavior and did not explain unavailable signed audio. | Fixed with explicit boundary; visited owner-scoped text and shell are cached, API responses are never cached, writes fail clearly, and uncached cross-origin signed audio remains network-dependent by contract. |
| UX-016 | Theme and typography | Browser theme test | Moderate | Manifest colors followed the legacy theme and Inter lacked an explicit source. | Fixed; Arc manifest colors, packaged Inter, dark mode, and reduced-motion behavior pass. |
| UX-017 | Feedback language | Browser journey | Moderate | Arc lacked one correction/review pattern and legacy behavior revealed answers too early. | Fixed; answers remain hidden until server grading and misses use one supportive correction pattern. |
| UX-018 | Full browser acceptance | Repository gate | Blocker | No browser, accessibility, or route-journey acceptance suite existed. | Fixed; Playwright mobile/desktop, axe, keyboard, retention, and offline checks are part of `pnpm test:ui`. |
| UX-019 | Calibration kit consistency | Server refusal probe | Blocker | GET and POST could use different generated answer keys. | Fixed; POST resolves the opaque owner/subject-bound kit issued by GET. The provider call count proves no second kit is generated. |
| UX-020 | Compile consent | Server refusal probe | Blocker | Source-only and no-source general-knowledge compilation could bypass client consent. | Fixed; the service rejects source-only compilation without an accepted source and no-source general-knowledge compilation without explicit confirmation, before status or provider side effects. |
| UX-021 | Compile replay | Server lifecycle probe | Blocker | Replaying a completed idempotency key could leave an active gap stuck compiling. | Fixed; terminal complete/partial replays restore active, failed replays restore failed, and in-flight duplicates remain compiling without a second provider charge. |
| UX-022 | Cross-gap submissions | Two-gap server probe | Blocker | An owned question from one gap could be submitted against another gap. | Fixed; attempt and proof paths verify current-curriculum membership before execution, metrics, attempts, evidence, or transitions. |
| UX-023 | Review scheduling | Server ladder probe | Major | Arc restarted review spacing through the attempt ladder. | Fixed; review grading suppresses attempt scheduling, completes the original review, then advances 3→7, resets failure to 1, or graduates at 7 through `scheduleAfterReview`. |
| UX-024 | Mastery explanation | Progress API and browser | Major | Progress omitted unmet evidence and called filled gaps “cleared.” | Fixed; Progress exposes actionable objective requirements, while external gap language and fields use `filled`; `cleared` remains objective-only. |
| UX-025 | Offline owner isolation | 375×812 owner-switch probe | Blocker | URL-only service-worker keys could return one learner’s cached Arc document to another. | Fixed; private Arc cache keys include the current owner, missing-owner pages are not cached, APIs are network-only, and an offline owner switch receives the safe fallback rather than prior content. |
| UX-026 | Telemetry and HTTP contract | Source/spec inspection and tests | Major | Attempt labels used model-generated objective IDs and source/compile OpenAPI shapes had drifted. | Fixed; attempt labels are closed question type/role categories, HTML is accepted and documented, and compile documents the synchronous 200 `{ run }` response including deduplication. |
| UX-027 | Calibration failure recovery | Independent failure/retry probe | Blocker | A diagnostic-provider failure left an orphan draft, and retry created another. | Fixed; schema-validated diagnostic success precedes persistence. Failure leaves zero gaps/calibrations and same-kit retry creates exactly one of each. |

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
  observes the actionable offline error, confirms the safe uncached-navigation document, and
  proves a changed owner cannot receive the previously cached lesson.
- Final automated evidence: `pnpm test:ui` passed 14 scenarios with two intentional desktop
  skips for the mobile-only offline contract; the production web build passed; `pnpm verify`
  passed 449 tests with 29 explicit Postgres, S3, and live-provider environment-gated skips.
- Independent verification at commit `35f501e` passed every GAP-033–037 acceptance area and all
  named refusal probes. Postgres, S3, and live-provider checks were recorded as not run because
  their environment variables or credentials were absent.

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
