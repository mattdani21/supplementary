# PRODUCT

## Thesis

People notice missing knowledge while already doing something else. Course platforms make them
find and evaluate a course whose scope and schedule may not match the immediate problem. General
AI chat can explain a topic, but it does not preserve the gap, sequence the learning, verify the
practice it generates, measure mastery, or retain the resulting capability.

GapOS converts:

> noticed gap → defined outcome → generated pathway → active practice → demonstrated mastery →
> retained capability

The product succeeds when a learner moves from "I need to understand this" to a usable, high
quality learning plan without designing the curriculum themselves.

## Boundaries

### MVP users

One learner per account. Desktop and mobile web. Independent study, not classroom management.
Technical, academic and professional topics. Source uploads up to a configurable limit.

### MVP course shape

One to seven days, fifteen to sixty minutes per day, audio-first with a transcript for every
lesson, retrieval questions plus worked problems plus a cumulative assessment, one language per
curriculum.

### Non-goals

Accredited qualifications. Real-time human tutoring. Public course publishing. Educator or cohort
dashboards. Automatic certification. Autonomous web research without source disclosure.
High-stakes medical, legal or safety certification. Any claim that consuming content equals
mastery.

## Success measures

| Metric | MVP target |
| --- | --- |
| Compile → usable Day 1 | under 3 minutes at p90 |
| Compile → complete seven-day package | under 10 minutes at p90 |
| Successful compilation rate | at least 95% |
| Learning session completion | at least 60% of started sessions |
| Practice items with verified solutions | 100% |
| Objectives present in both teaching and assessment | 100% |
| Audio lessons with matching transcript | 100% |
| Completed capabilities discoverable through search | 100% |

Learning-quality invariants, enforced by tests rather than by intent:

- every curriculum has explicit measurable objectives;
- every objective maps to at least one lesson, two retrieval items and one application item;
- every generated problem is independently solved or rubric-checked before publication;
- a gap is only `filled` after evidence from at least two sessions including one cumulative or
  transfer task;
- unsupported factual claims are removed, repaired or labelled;
- reported confusion and repeated errors create remediation items.

## Journeys

### Capture and compile

New gap → enter or dictate the need → confirm extracted fields (current state, target capability,
deadline, daily minutes, preferred format, source boundaries) → upload sources or allow general
knowledge → short diagnostic or *skip and infer* → Compile → watch generation progress and receive
Day 1 as soon as it passes validation.

### Daily learning

Open Today → recall warm-up → play lesson audio with optional transcript and key visual → answer
embedded pause prompts → complete practice with solutions hidden → review corrections and record
confidence → receive the next review date and any remediation.

### Close a gap

Cumulative assessment → objective-level mastery threshold met → at least one delayed retrieval or
transfer check → gap marked `filled` → capability, evidence, artefacts and review schedule stored
in the library.

### Reuse prior knowledge

Define a new gap → system retrieves relevant completed capabilities → mastered prerequisites are
not retaught unless diagnostic evidence shows decay → the new curriculum links into the learner's
knowledge graph.

## Information architecture

| Area | Purpose |
| --- | --- |
| Gap Inbox | capture, clarify and prioritise gaps |
| Today | current audio, practice and review queue |
| Active | curricula in progress and generation status |
| Capabilities | search completed gaps and retained artefacts |
| Knowledge Map | prerequisites, strengths, weak areas, due reviews |
| Settings | profile, providers, retention, accessibility |

Gap workspace tabs: Overview, Sources, Curriculum, Learn, Practice, Mastery, Generation log.

The generation log is user-readable: stages and recoverable errors, never model reasoning.

## Domain model

| Entity | Important fields |
| --- | --- |
| User | id, locale, timezone, accessibility preferences |
| LearnerProfile | goals, preferred lesson length, baseline domains |
| Gap | title, raw statement, current state, target capability, deadline, daily minutes, status |
| Source | owner, gap, filename, media type, checksum, processing status |
| SourceChunk | source, text, locator, embedding, extraction confidence |
| Diagnostic | gap, questions, inferred assumptions, score |
| Curriculum | gap, duration, daily minutes, version, status, quality score |
| Objective | curriculum, capability statement, prerequisite links, mastery rule |
| Lesson | curriculum, day, order, title, duration, publication status |
| Artefact | lesson, type, storage location, checksum, version |
| Question | lesson, objective, type, difficulty, prompt, answer, rubric, source links |
| Attempt | learner, question, response, correctness, hints, confidence, completed time |
| MasteryEvidence | learner, objective, evidence type, score, independence, timestamp |
| ReviewItem | learner, objective or question, due time, interval, state |
| GenerationRun | gap, pipeline version, status, timing, estimated cost |
| GenerationStep | run, name, attempt, status, input version, output version, error |
| AuditFinding | run, target, severity, category, finding, repair status |
| KnowledgeEdge | source capability, target capability, relationship, confidence |

### Gap lifecycle

`draft → ready → compiling → active → mastery_check → filled`, with `review_due` re-entering from
`filled`, plus `archived` and `failed` as terminal-ish exits. Only server-side domain methods may
change status; database clients must not write status values directly.

### Generation lifecycle

`queued → ingesting → planning → generating_lessons → generating_assessment → auditing →
repairing → synthesising_audio → publishing → complete`, with `partial`, `failed` and `cancelled`
as alternative outcomes. Every step is idempotent.

## Mastery model

Evidence is tracked per objective, not as one course percentage. Dimensions: correctness,
difficulty, hint use, response confidence, recency, delayed retrieval, transfer.

An objective is `mastered` when all of the following hold:

1. at least 80% across a representative item set;
2. evidence from at least two separate sessions;
3. at least one item completed without hints;
4. at least one item requiring application or transfer;
5. no critical prerequisite objective below threshold.

A gap is `filled` when every required objective is mastered. Optional objectives never block
completion.

Review scheduling starts as a transparent fixed ladder — same-session correction, next day, three
days, seven days, and a later review when confidence falls. An adaptive algorithm is only
introduced once enough attempt data exists to evaluate it.

## Final MVP acceptance scenario

Given a new learner with no existing data, who enters *"I understand basic set notation but need
relations and proof techniques by Friday. I have 35 minutes per day"* and uploads approved source
material:

- the system diagnoses or records labelled baseline assumptions;
- Day 1 is usable within three minutes;
- the full course completes within ten minutes on the reference workload;
- audio, transcript and practice all work;
- incorrect answers create corrections and scheduled retrieval;
- every published item has a verified solution and objective links;
- delayed and transfer checks are completed;
- the gap becomes `filled` only when every required objective meets the rule;
- the capability is searchable and can inform a later curriculum.
