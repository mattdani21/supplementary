# Arc core learner journey

Status: implementation contract for GAP-033 through GAP-037.

## Product boundary

Arc is the learner-facing web application. The supported journey is:

`define → source → diagnose → compile → listen → practise → correct → prove → retain`

The legacy `/gaps/*` routes remain compatibility surfaces while Arc is migrated. New learner
behavior belongs under `/arc`; educator review remains under `/review`.

Every Arc projection uses persisted domain data. The browser never declares calibration
correctness, compilation success, practice correctness, mastery, or a gap status.

## Routes and states

### `/arc`

- A first-time learner sees one primary action to start calibration and explanatory empty copy.
- An active learner sees one next lesson or review action, not a dead count.
- Due reviews link to `/arc/reviews`.
- Failed or partial work identifies the affected gap and offers a retry or safe return.

### `/arc/calibrate`

- Capture subject, useful outcome, daily minutes, optional deadline, and source policy.
- The server supplies and grades the baseline question.
- The client must not infer or reveal the correct baseline answer.
- Back navigation preserves completed choices. Provider failure keeps those choices and offers
  retry.
- Success creates one persisted draft gap with the confirmed constraints and routes to setup.

### `/arc/skills/{gapId}/setup`

- Show the confirmed brief before compilation.
- `sources_only` requires at least one accepted source. Text, Markdown, and HTML files are read in
  the browser and registered through the existing source boundary; pasted text is also supported.
- `general_knowledge_allowed` may compile with no upload only after explicit confirmation.
- Starting compilation first applies the `define` domain transition, then calls the idempotent
  compile boundary. An ambiguous network retry reuses its attempt key; a deliberately retried
  terminal failure receives a new attempt key so the failed run is not merely replayed.
- The page represents real statuses: draft, ready, compiling, active, failed, and archived. It
  never fabricates generation-step completion.
- A successful run routes to the skill map as soon as a published lesson is available. A failed
  run shows its recoverable message and retry action.

### `/arc/skills`

- Search includes active skills and filled capabilities.
- Empty library and no-result states include a recovery action.
- Draft/ready gaps continue setup; active/review-due/filled gaps open their map.

### `/arc/skills/{gapId}`

- Show objective progress from mastery evidence and exactly one current objective.
- Current and cleared objectives are semantic links. Later objectives remain readable and explain
  their prerequisite without using an inaccessible disabled control.
- Empty curriculum, compiling, failed, and all-cleared states each have a next action.

### `/arc/skills/{gapId}/lesson`

- Theory includes real TTS controls when audio exists and the matching transcript in all cases.
- Practice supports code proof, multiple choice, and free response. Solutions remain hidden until
  submission.
- Non-code submission records confidence and hint use. Incorrect work shows correction and the
  scheduled follow-up without advancing mastery incorrectly.
- Lesson tabs implement the complete ARIA tabs pattern and keyboard arrow navigation.
- `audioTheory=false` opens practice first. `gentleHints=false` does not reveal the hint control.

### `/arc/reviews`

- List due learner reviews with gap, capability, reason, and due time.
- A review response is graded on the server. The client cannot send a trusted correctness flag.
- Completion shows the next scheduled review, or states that the fixed ladder is complete.
- Empty and stale-review states return safely to Today.

### `/arc/progress`

- Explain objective-level evidence still needed for active gaps.
- Filled gaps appear as retained capabilities with evidence date and a searchable label.
- Product language uses `filled` for a gap and `mastered` only for an objective.

## Interaction states

Every network action has an idle, pending, success, and recoverable failure presentation. Pending
controls remain labelled and cannot be submitted twice. Errors use `role="alert"` when immediate
action is required; success and progress messages use polite status announcements.

The app must provide intentional first-run, empty search, no source, no audio, no practice,
compiling, partial, failed, offline, and all-cleared states. Each state offers a valid next action.

## Responsive and accessibility contract

- Primary test viewports are 375×812 and 1440×900. Content remains usable from 320px upward.
- The phone layout is single-column. At desktop width, the shell may use two columns but preserves
  reading and focus order.
- Standalone navigation observes `env(safe-area-inset-bottom)`.
- Interactive targets are at least 44×44 CSS pixels, except inline text links with adequate
  surrounding spacing.
- Exactly one primary navigation item has `aria-current="page"`.
- Focus is visible, logical, and restored to the relevant heading after client-side flow changes.
- Color is never the only status signal. Text remains readable at 200% zoom.
- Motion is non-essential and removed under `prefers-reduced-motion: reduce`.
- Automated axe checks permit no serious or critical violations on the listed routes.

## Offline contract

The visited Arc shell and textual lesson fallback remain navigable after the network is removed.
Writes require a network and explain that requirement. Cross-origin signed audio is not promised
offline; the transcript remains the accessible fallback.

## Operational behavior

Metrics record calibration completion, setup completion, compile start/result/retry, practice
submission outcome, review completion, and capability search. Metric attributes contain stable
categories and never source text, answers, code, lesson content, or learner-entered queries.

## Acceptance scenarios

1. A new learner calibrates, confirms constraints, supplies an approved source, compiles, opens
   Day 1, listens or reads, completes practice, receives correction, proves the required
   objectives over qualifying sessions, and finds the filled capability in search.
2. A learner explicitly choosing general knowledge completes the same path without a source.
3. Provider, source, compile, audio, practice, and offline failures preserve entered work and
   provide a recovery action.
4. The journey passes with deterministic providers at the mobile and desktop viewports, with
   keyboard-only interaction and the accessibility contract above.

