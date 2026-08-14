# Feature Specification: Content Engine Quality (E24)

**Feature Branch**: `001-content-engine-epic`

**Created**: 2026-08-14

**Status**: Draft

**Input**: User description: "The content engine epic (E24): user-specific curriculum quality is the moat. The compile pipeline must produce curricula that feel like a human teacher designed them. Lesson scripts must read human, not model-dump (concrete opening, one idea per segment, worked example, checkpoint question), scored by a human-sounding rubric in the evaluation pack. Every objective traces to a source locator. The planner's valid-plan hit rate improves materially (target: >=80% first-attempt valid plans on reference packs), never by weakening the validation gate. Sources are the spine: unsupported claims removed/repaired/labelled. Per-user personalization: the curriculum is a function of gap + sources + diagnostic + learner profile + mastery evidence — no two learners get the same curriculum."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every lesson reads like a real teacher wrote it (Priority: P1)

A learner compiles a course and every lesson they hear is recognizably teaching, not output: it
opens with a concrete situation they recognize, builds one idea at a time, works a real problem
aloud, and stops to check they are still following. Nothing in the script reads like a
bullet-pointed model dump, a summary of a document, or a lecture about the lesson itself.

**Why this priority**: Content is the moat (Constitution §3). The compile pipeline's entire value
is a curriculum that *feels* designed by a human teacher; if the script quality is not enforced
by measurement, it will regress the moment a prompt or provider changes.

**Independent Test**: Compile a reference curriculum, score every published lesson script against
the human-sounding rubric in the evaluation pack, and confirm every script clears the floor.
Separately, degrade a script into a model-dump form (meta-opening, list-like prose, no worked
example, no checkpoint) and confirm the rubric scores it below the floor. This delivers the
quality contract with one verifiable measurement.

**Acceptance Scenarios**:

1. **Given** a compiled reference curriculum, **When** every published lesson script is scored
   against the human-sounding rubric, **Then** every script meets or exceeds the rubric floor and
   each structural element is present: a concrete opening, one idea per segment, a worked
   example, and a checkpoint question.
2. **Given** a lesson script that opens with a statement about the lesson rather than the
   subject, or lists points instead of teaching them, or contains no worked example, or contains
   no checkpoint question, **When** it is scored by the human-sounding rubric, **Then** it scores
   below the floor and the failing element is named.
3. **Given** a learner listening to a lesson, **When** the checkpoint question is reached,
   **Then** the lesson pauses and requires a response before continuing, and the response is
   handled like any practice answer (correct → confirm; incorrect → repair surface with the
   verified answer and source link).

---

### User Story 2 - Every objective and every claim points back to its source (Priority: P1)

Sources are the spine. A learner can see, for every objective, every lesson, and every practice
question, exactly which part of their own material supports it. A claim that the source does not
support is never shipped as fact: it is removed, repaired by finding the supporting passage, or
explicitly labelled as outside the sources — and the choice is recorded.

**Why this priority**: Unsupported claims are the fastest way to destroy trust in a
source-grounded product, and the constitution makes traceability a non-negotiable invariant. This
is the property that makes a GapOS course different from a chat answer.

**Independent Test**: Invariant tests assert that 100% of published objectives, lessons, and
questions carry a source locator or an explicit general-knowledge label, and that every
audit-recorded unsupported claim has a resolution (removed / repaired / labelled) before
publication. This delivers traceability as a machine-checkable guarantee.

**Acceptance Scenarios**:

1. **Given** a published curriculum, **When** a learner opens any lesson or practice question,
   **Then** the supporting source locator is visible next to the content and the source is one
   step away.
2. **Given** a generated objective, lesson, or question that claims source grounding,
   **When** it is checked against the supplied sources, **Then** it cites at least one real
   locator, or it is refused.
3. **Given** an unsupported claim detected in generated teaching material, **When** the audit
   runs, **Then** the claim is removed, repaired with a real source locator, or labelled as
   outside the sources before anything is published, and the finding and its resolution are
   recorded.

---

### User Story 3 - Compiles produce a valid plan on the first attempt (Priority: P1)

A learner's compile is not a lottery: on the reference packs, the first curriculum plan the
planner produces passes the full validation gate at least 80% of the time. Rejected plans are
still rejected (every invariant still holds — the gate never weakens), but rejection becomes the
exception rather than the expected first round.

**Why this priority**: Each rejected plan costs a provider round-trip and wall-clock time against
a hard latency budget (Day 1 in three minutes, full course in ten). Raising the first-attempt hit
rate is the highest-leverage content improvement that does not touch the gate.

**Independent Test**: A runnable harness compiles the reference packs and reports the share of
compiles whose first planner output passes validation, plus the per-invariant breakdown of the
rejections. A guard test proves the gate still rejects every known-bad plan shape. This delivers
the hit-rate target as a measured, reproducible number.

**Acceptance Scenarios**:

1. **Given** the reference packs, **When** the planner produces its first plan for each compile,
   **Then** at least 80% of those first attempts pass the full validation gate.
2. **Given** a plan that exceeds the daily time budget, leaves an objective untaught or
   unassessed, contains a prerequisite cycle or an unmet prerequisite, or claims source grounding
   with no locator, **When** it is sent to the validation gate, **Then** it is still rejected with
   every violation returned together.
3. **Given** a rejected plan, **When** the planner is asked to repair it, **Then** all violations
   are addressed in one round and the run records which invariants were violated, so the hit-rate
   diagnosis names the weakest invariant.

---

### User Story 4 - No two learners get the same curriculum (Priority: P2)

Two learners who want the same capability do not receive the same course. The curriculum is a
function of the gap, the sources, the diagnostic, the learner profile, and the learner's mastery
evidence. A learner who already proved a prerequisite is not re-taught it; a learner whose prior
evidence has decayed re-demonstrates it; a learner's stated goals, preferred lesson length, and
history shape the plan.

**Why this priority**: Personal fabrication is the product (Constitution §1). Differentiation is
what makes the moat; without it the product is a course generator, not a personal fabricator.

**Independent Test**: A differentiation test compiles the same gap with the same sources for
learners whose diagnostic, profile, or mastery evidence differ and asserts the curricula differ
measurably. A reuse test asserts mastered prerequisites are not retaught (brief recall only)
unless decayed. This delivers personalization as a demonstrated property, not a claim.

**Acceptance Scenarios**:

1. **Given** two learners with the same gap and the same sources but different diagnostics,
   learner profiles, or mastery evidence, **When** each compiles, **Then** the resulting curricula
   differ measurably (objectives, sequencing, pacing, or starting difficulty).
2. **Given** a learner whose mastery evidence shows a prerequisite capability was recently
   mastered, **When** a new curriculum is planned, **Then** the prerequisite is treated as
   satisfied without a full lesson (at most a brief recall check on Day 1).
3. **Given** a learner whose mastery evidence for a prerequisite has decayed, **When** a new
   curriculum is planned, **Then** the capability is re-demonstrated (for example through the
   diagnostic) rather than assumed, and the plan reflects it.
4. **Given** a learner's profile stating goals and a preferred lesson length, **When** the plan is
   produced, **Then** the plan shape (daily structure, pacing, starting difficulty) reflects the
   profile within the learner's stated time budget.

---

### User Story 5 - Quality regressions are caught before learners see them (Priority: P2)

The evaluation gate is a contract, not a vibe. Every change to content, prompts, or the pipeline
re-scores the reference packs; a score that falls below its floor, or more than tolerance below
its recorded baseline, fails the gate and names the dimension that slipped. The new human-sounding
dimension is added to the same contract.

**Why this priority**: Evidence over assertion (Constitution §4). The gate is the only thing that
stops quality from eroding silently, and it must notice the day a score slips even when it still
clears the floor.

**Independent Test**: The evaluation gate runs on every verification; it re-scores the reference
curricula, compares against stored baselines, and reports any regression beyond tolerance. A
degradation suite proves each dimension (including the new human-sounding dimension) fails when
its specific defect is introduced. This delivers regression protection as an automated check.

**Acceptance Scenarios**:

1. **Given** a stored baseline for a reference curriculum, **When** a change lowers any dimension
   more than the tolerance below that baseline, **Then** the evaluation gate fails and the report
   names the dimension and the specific observation.
2. **Given** a change intended to improve script quality, **When** the reference pack is
   re-scored, **Then** the human-sounding dimension clears its floor and no existing dimension
   regresses beyond tolerance.
3. **Given** the recorded evidence of any claimed improvement (hit rate, script quality,
   traceability), **When** another engineer runs the documented command, **Then** they reproduce
   the same result.

---

### Edge Cases

- **A source that contradicts itself or mixes conflicting terminology** (e.g. one textbook's
  "feature" is another's "field"): the curriculum must choose one vocabulary, say which it chose,
  and flag the collision explicitly — never silently mix vocabularies across days.
- **A source containing instruction-like text** (prompt injection): the injected paragraph is
  recorded as a finding, never followed, never graded against, and never taught; any content
  whose cited evidence is an injected chunk is refused.
- **An underspecified request** ("I want to get better at maths"): the compile pauses with a
  blocking clarification rather than guessing a topic and compiling the wrong course.
- **A one-day emergency**: the plan fits the deadline; a seven-day plan for a tomorrow deadline
  is a failure, not a bonus.
- **Prior mastery**: mastered prerequisites are not retaught; a brief recall check on Day 1 is
  correct, a full lesson on them is a defect.
- **No sources supplied**: general knowledge is permitted but must be explicitly labelled; it may
  never be dressed as sourced, and the learner is told what is general knowledge and what is not.
- **A true claim that is not in the supplied sources**: treated as unsupported — removed, repaired
  with a real locator, or labelled — never shipped as if the source said it.
- **A source that fails to extract**: the compile degrades gracefully with labelled general
  knowledge and a visible notice; the vertical slice keeps working.
- **Two learners, same gap, same sources, different profiles**: they must receive different
  curricula — identical output here is the specific failure the personalization promise forbids.
- **A plan that barely fails**: still rejected with every violation returned; the gate does not
  develop a tolerance for bad plans.

## Requirements *(mandatory)*

### Functional Requirements

**Script quality — lessons read human, not model-dump**

- **FR-001**: Every published lesson script MUST open with a concrete, learner-facing opening — a
  situation, question, or problem the learner recognizes — and MUST NOT open with a statement
  about the lesson, the curriculum, or the generation process.
- **FR-002**: Every published lesson script MUST be organized into segments that teach exactly one
  idea each.
- **FR-003**: Every published lesson script MUST contain at least one worked example — a problem
  worked step by step within the script, not merely referenced.
- **FR-004**: Every published lesson script MUST contain at least one checkpoint question that
  pauses the learner and requires a response before the lesson continues.
- **FR-005**: The evaluation pack MUST score lesson scripts on a human-sounding rubric dimension
  covering the four structural elements (concrete opening, one idea per segment, worked example,
  checkpoint question), with a published minimum floor.
- **FR-006**: The human-sounding rubric MUST be calibrated against the reference curricula and
  MUST include degradation tests: a script that reads like a model dump (meta-opening, list-like
  or bulleted prose, no worked example, no checkpoint, visual deixis) MUST score below the floor.
- **FR-007**: The compile pipeline MUST generate lesson scripts against the four structural
  elements and MUST verify them before publication, so a script missing an element is repaired or
  excluded rather than shipped.

**Traceability — sources are the spine**

- **FR-008**: Every objective, every published lesson, and every published practice question MUST
  trace to at least one source locator or MUST be explicitly labelled as general knowledge; a
  source-grounded item with no locator MUST be refused.
- **FR-009**: Any unsupported claim detected in generated teaching material MUST be removed,
  repaired with a real source locator, or labelled as outside the sources BEFORE publication, and
  the finding and its resolution MUST be recorded.
- **FR-010**: Source text MUST be treated as evidence, never as instruction: instruction-like
  content in a source MUST be recorded as a finding and MUST NOT influence the curriculum, the
  grading, or the teaching, and any item citing such content MUST be refused or repaired.
- **FR-011**: The learner MUST be able to see the source locator(s) behind every published lesson
  and every practice question, so traceability is user-visible, not only an internal invariant.

**Planner hit rate — valid on the first attempt, without weakening the gate**

- **FR-012**: A runnable measurement MUST report the planner's first-attempt valid-plan rate on
  the reference packs — the share of compiles whose FIRST planner output passes the full
  validation gate — plus the per-invariant breakdown of any rejections.
- **FR-013**: The first-attempt valid-plan rate on the reference packs MUST reach at least 80%,
  while every existing plan invariant (time budget, teach-and-assess coverage, prerequisite
  integrity, evidence grounding) remains enforced exactly as strictly or more so.
- **FR-014**: When a plan is rejected, all violations MUST be returned together in one repair
  round, and the plan step MUST record which invariants were violated so the hit-rate diagnosis
  names the weakest invariant.
- **FR-015**: A guard test MUST prove the validation gate still rejects every known-bad plan
  shape — a plan over the daily budget, an untaught or unassessed objective, a prerequisite cycle
  or unmet prerequisite, and a source-grounded objective with no locator — so a higher hit rate
  can never come from a weaker gate.

**Personalization — the curriculum is a function of five inputs**

- **FR-016**: The curriculum MUST be a function of the gap, the sources, the diagnostic, the
  learner profile, and the mastery evidence; the planner MUST receive all five as inputs, not
  only the gap statement and diagnostic.
- **FR-017**: Two learners with the same gap and the same sources but different diagnostics,
  learner profiles, or mastery evidence MUST receive measurably different curricula, and a
  differentiation test MUST cover the differing-input combinations.
- **FR-018**: Prior mastered capabilities MUST satisfy prerequisites without being retaught
  (at most a brief recall check), and capabilities whose mastery evidence has decayed MUST be
  re-demonstrated rather than assumed.
- **FR-019**: The learner profile (goals, preferred lesson length, accessibility preferences)
  MUST influence plan shape — daily structure, pacing, and starting difficulty — within the
  learner's stated daily time budget.
- **FR-020**: The learner's mastery evidence MUST influence what is retaught, what is skipped,
  and what is scheduled for review inside the new curriculum.

**Gate integrity and evidence**

- **FR-021**: The evaluation pack MUST continue to pass the reference curricula on every existing
  dimension at its existing floor, and MUST record baselines; the human-sounding dimension is
  additive and no existing floor or invariant MAY be lowered.
- **FR-022**: Every claimed improvement (hit rate, script quality, traceability) MUST be backed
  by a runnable measurement whose command and result are recorded as evidence; a self-report is
  not a result.

### Key Entities *(include if feature involves data)*

- **Gap**: the product object — title, raw statement, current state, target capability, deadline,
  daily minutes, status. The personalization function's first input.
- **Source / SourceChunk**: the learner's material, split into chunks, each with a locator
  (human-meaningful position such as a section or page reference). The spine: every objective,
  lesson, and question traces back to one.
- **Diagnostic**: the learner's demonstrated capabilities, knowledge gaps, inferred assumptions,
  and recommended starting difficulty. A personalization input.
- **LearnerProfile**: goals, preferred lesson length, baseline domains, accessibility
  preferences. A personalization input.
- **MasteryEvidence**: per-objective record of correctness, difficulty, hint use, confidence,
  recency, delayed retrieval, and transfer. A personalization input and the source of decay
  judgments.
- **Curriculum / Objective**: the plan — objectives with capability statements, prerequisite
  links, mastery rules, and evidence (basis + locators); days with activities within the daily
  budget; the assessment blueprint. The planner's output and the hit-rate target.
- **Lesson**: day, order, title, script with the four structural elements, transcript, summary,
  estimated duration, publication status.
- **Question**: objective link, type, role (retrieval / application / transfer), difficulty,
  prompt, answer, rubric, source links.
- **AuditFinding**: run, target, severity, category, finding, repair status — the record of
  unsupported claims, injection detections, and their resolution (removed / repaired / labelled).
- **GenerationRun / GenerationStep**: pipeline version, status, plan attempts and their
  violations — the record the hit-rate measurement reads.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 80% of reference-pack compiles produce a valid curriculum plan on the
  first planner attempt, measured by the reference-pack harness, while the guard test confirms
  every known-bad plan shape is still rejected.
- **SC-002**: 100% of published lesson scripts on the reference packs score at or above the
  human-sounding rubric floor, and each rubric element has a degradation test proving a
  model-dump script fails below the floor.
- **SC-003**: 100% of published objectives, lessons, and practice questions trace to a source
  locator or are explicitly labelled general knowledge, and 100% of unsupported claims found by
  the audit are removed, repaired, or labelled before publication.
- **SC-004**: The differentiation test shows that two learners with the same gap and sources but
  different diagnostics, learner profiles, or mastery evidence receive measurably different
  curricula — zero identical curricula across the differing-input test matrix.
- **SC-005**: The evaluation gate never weakens: every existing score floor holds, no previously
  passing reference curriculum regresses beyond tolerance against its baseline, and the
  human-sounding dimension clears its floor.
- **SC-006**: Every published practice item shows its source link, and the learner can reach the
  supporting source in one step (100% of published items).
- **SC-007**: The compile latency budget holds with the added rubric checks and hit-rate work:
  Day 1 is usable within three minutes and the full course completes within ten minutes (p90) on
  the reference workload.
- **SC-008**: All improvement evidence is reproducible: the recorded commands and measurements
  for the hit rate, the script quality scores, and the traceability invariants are stored with
  the run that produced them.

## Assumptions

- **"Reference packs"** are the evaluation pack's reference curricula: the deterministic
  reference compile runs in the automated quality gate, and the full pack is scored in the
  live-model gate; the 80% target applies to the pack as measured by the harness.
- **"First attempt"** means the first planner output for a compile, before any repair round; the
  hit-rate metric counts compiles, not attempts, and excludes runs that paused for a blocking
  clarification.
- **Differentiation is driven by inputs, not randomness**: planning stays deterministic, so
  identical inputs may produce identical curricula (idempotency is a requirement); "no two
  learners get the same curriculum" means differing inputs must yield differing curricula, which
  is the testable claim.
- **The human-sounding rubric is additive**: existing score floors, baselines, and invariant
  tests remain untouched; the new dimension's floor is set from the reference curricula and
  documented in the evaluation pack.
- **Baseline updates follow the existing deliberate flow**: an improvement is reported, and a
  baseline is updated only with evidence and review — never silently.
- **General knowledge remains permitted** only when no source is supplied or the claim is
  genuinely outside the supplied sources, and it is always labelled as such.
- **Scope boundary**: this epic changes what the pipeline produces and how quality is measured;
  the only new user-facing surface is the source-link affordance. Product scope, the vertical
  slice, and the architecture rules are unchanged.
- **Cost is a design input**: the rubric is scored deterministically wherever possible, any
  model-assisted grading is budget-gated, and idempotency is preserved so retries never
  double-charge.
- **Data ownership**: per-user isolation is a product promise; any cross-learner intelligence is
  aggregate only and never exposes individual learning data.
- **Accessibility**: any new surface (source links, checkpoint handling) follows the existing
  accessibility floor; audio-first remains the primary experience.
- **Dependencies**: this epic builds on the completed curriculum planning and validation work,
  the evaluation harness with its reference packs and baselines, and the quality taste contract.
- **Out of scope for this epic**: gamification, social features, real-time human tutoring,
  educator dashboards, certification, autonomous web research without source disclosure, and any
  weakening of the validation gate.
