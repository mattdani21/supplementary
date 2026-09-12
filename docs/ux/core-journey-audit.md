# Arc core-journey UX audit

This is the running evidence log for GAP-033 through GAP-037. It separates behavior exercised in
the static founder prototype from behavior confirmed in application code. Implementation status
is updated after each browser pass.

## Test matrix

| Pass | Surface | Viewport | Input | Result |
| --- | --- | --- | --- | --- |
| P0 | Founder prototype | 400px mobile, 1280px desktop | Pointer; light/dark themes | Completed 2026-09-12 |
| P1 | Arc application | 375×812, 1440×900 | Keyboard and pointer | Pending |
| P2 | Arc offline fallback | 375×812 | Browser offline mode | Pending |

## Findings

| ID | Route or screen | Evidence | Severity | Finding | Disposition |
| --- | --- | --- | --- | --- | --- |
| UX-001 | `/arc/calibrate` → map | Code | Blocker | Calibration creates a draft with fixed 35-minute duration, then links to a map with no curriculum. Sources, definition, and compilation are absent from Arc. | Observed; GAP-035 |
| UX-002 | `/arc` navigation | Code | Major | Today uses a prefix match, so Today and a nested primary tab can both be active. | Observed; GAP-034 |
| UX-003 | Skill map | Code | Major | A server component attaches `onClick` and accesses `window`; later objectives are disabled controls that cannot explain themselves to keyboard users. | Observed; GAP-034 |
| UX-004 | Lesson tabs | Code | Major | Tabs have `tab` roles but no tabpanels, controls, ids, roving focus, or arrow-key behavior. | Observed; GAP-034 |
| UX-005 | Today reviews | Code and prototype | Blocker | Due reviews render only a heading and count. No learner review route or completion action exists. | Observed; GAP-036 |
| UX-006 | Lesson practice | Code | Blocker | Arc supports only code-proof practice; non-code lessons send learners away from the consumer flow and do not collect confidence. | Observed; GAP-036 |
| UX-007 | Retention | Code and prototype | Blocker | Filled capabilities are searchable in the service layer but not reachable in Arc. | Observed; GAP-036 |
| UX-008 | Preferences | Code and prototype | Major | `audioTheory` and `gentleHints` persist but do not change lesson behavior. | Observed; GAP-036 |
| UX-009 | Calibration baseline | Code | Major | The client guesses the correct option by array position and may contradict the server verdict. | Observed; GAP-035 |
| UX-010 | Arc shell | Code | Major | The shell is a fixed 520px phone column with no desktop layout, safe-area padding, or route loading/error boundaries. | Observed; GAP-034/GAP-037 |
| UX-011 | Arc icon controls | Code | Moderate | Several icon buttons are 38px, below the 44px touch target contract. | Observed; GAP-034 |
| UX-012 | First run and empty states | Prototype and code | Major | Prototype contains only populated data; Today and Skills lack intentional first-run recovery content. | Observed; GAP-034/GAP-037 |
| UX-013 | Loading and network errors | Prototype and code | Major | Apart from calibration/notebook pending copy, Arc has no route skeletons or consistent alerts/retry actions. | Observed; GAP-034/GAP-037 |
| UX-014 | Skills search | Prototype | Moderate | Prototype accepts a search query without filtering. Application code filters active gap titles but does not search retained capabilities. | Partially implemented; GAP-036 |
| UX-015 | PWA | Code | Major | Service-worker behavior was designed around the legacy study route; signed Arc audio is not available offline and the limitation is not communicated. | Observed; GAP-037 |
| UX-016 | Theme and typography | Code | Moderate | Manifest color follows the legacy dark theme and Inter is referenced without an explicit font source. | Observed; GAP-034 |
| UX-017 | Feedback language | Code | Moderate | Legacy practice reveals “model answer” immediately and Arc lacks one consistent correction/review pattern. | Observed; GAP-036 |
| UX-018 | Full browser acceptance | Repository | Blocker | API/domain coverage is strong, but there is no browser, accessibility, or visual-state acceptance suite. | Observed; GAP-033 |

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

