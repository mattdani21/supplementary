# ARCHITECTURE

## Stack

TypeScript end to end for the MVP, to keep the integration surface small enough that a coding
agent can work across the whole product.

| Layer | Decision |
| --- | --- |
| Web application | Next.js with a responsive PWA shell |
| Styling | Tailwind CSS over accessible component primitives |
| Application API | Next.js route handlers |
| Database | PostgreSQL |
| Authentication | managed email and social authentication |
| Object storage | S3-compatible, private by default |
| Semantic retrieval | PostgreSQL vector extension behind a repository interface |
| Background work | database-backed durable job queue + TypeScript worker |
| AI generation | provider-neutral adapter with structured JSON contracts |
| Speech in / out | provider-neutral STT and TTS adapters |
| Observability | structured logs, traces, metrics, error reporting |
| Local development | Docker Compose for Postgres and S3-compatible storage |
| Deployment | one web service, one worker service, managed database and object storage |

Rust is deliberately absent from the MVP critical path. It may be introduced later for a
*measured* bottleneck — document parsing, local inference orchestration, high-throughput audio —
never speculatively. The early constraint is correctness and iteration speed, not CPU.

## Component responsibilities

**Web client** — gap capture and editing, source upload, generation progress stream, audio player
with transcript synchronisation, practice interface, mastery and search views, offline cache for
already-downloaded lessons.

**Application API** — authentication and authorisation, gap and curriculum CRUD, signed upload and
download, compilation initiation, attempt recording, mastery calculation, search and Today queue
assembly.

**Generation worker** — source extraction and chunking, curriculum planning, parallel lesson
generation, practice generation, independent solution verification, targeted repair, speech
synthesis, publication of validated artefacts.

**Retrieval service** — index source chunks, retrieve evidence for objectives and lessons,
retrieve prior capabilities that may satisfy prerequisites, and enforce ownership and curriculum
boundaries on every query without exception.

**Mastery engine** — score attempts deterministically where possible, use rubric-assisted grading
only where necessary, compute objective-level evidence and confidence, schedule reviews, and
decide whether a gap is ready for a mastery check, filled, or due for review.

## Dependency rules

    apps/web ──┐
               ├──▶ packages/domain ◀── (pure; depends on nothing in this repo but ai-contracts types)
    apps/worker┘
        │
        ├──▶ packages/database          (repositories, migrations, ownership)
        ├──▶ packages/provider-adapters (LLM / STT / TTS behind interfaces)
        ├──▶ packages/ai-contracts      (zod schemas, versioned)
        └──▶ packages/observability     (logs, metrics, cost)

Enforced by lint (`no-restricted-imports`) and by review:

- domain never imports Next.js, React, `pg`, or a provider SDK;
- application code never imports a provider SDK — only the adapter interfaces;
- nothing persists a model response that has not passed its zod contract.

## Compilation pipeline

| Stage | Name | Output |
| --- | --- | --- |
| A | Normalise the gap | topic, current state, target capability, observable success condition, assumed prerequisites, ambiguities, recommended diagnostic |
| B | Ingest and ground sources | typed extraction, semantic chunks with page/slide/heading/timestamp locators, index, coverage summary |
| C | Diagnose | five to ten adaptive questions, or a labelled conservative inference plus a Day 1 calibration activity |
| D | Plan the curriculum | measurable objectives, prerequisite graph, exclusions, daily sequence, time estimates, assessment blueprint, source coverage, audio and visual requirements |
| E | Generate lessons in parallel | script, transcript, summary, examples, pause prompts, retrieval and application questions, answers and rubrics, source references, accessibility text |
| F | Verify independently | solve each question independently, test distractors, check rubric tolerance, detect answer leakage, check difficulty, maths and logic, source support, spoken clarity, duration, coverage |
| G | Repair | only failed artefacts, at most two automated attempts, then exclude or mark the run partial |
| H | Synthesise and publish | stable audio segments, parallel synthesis, integrity checks, incremental publication starting with Day 1, frozen published version |

Stage A requests clarification only when the ambiguity would materially change the curriculum;
otherwise it records a labelled assumption and continues.

Stage D rejects a plan that exceeds the learner's available time, leaves an objective unassessed,
or depends on an unaddressed prerequisite.

Stage E treats the plan, glossary and objective identifiers as immutable inputs, so parallel
generation cannot cause terminology drift.

Stage F is a genuinely independent verifier: it solves, it does not merely critique prose, and a
failed verifier can never approve its own output.

Edits create new versions. Published artefacts used by recorded attempts are frozen.

## Latency budget

| Work | Budget | Execution |
| --- | --- | --- |
| Upload finalisation and extraction | 60 s | concurrent by source |
| Gap normalisation and retrieval | 30 s | concurrent where safe |
| Diagnostic interpretation and plan | 45 s | sequential |
| Seven lesson packages | 180 s | parallel, bounded concurrency |
| Assessment verification | 120 s | parallel by artefact |
| Targeted repairs | 90 s | failed artefacts only |
| Audio synthesis | 180 s | parallel after scripts pass |
| Packaging and publication | 30 s | incremental |

Target wall-clock: under nine minutes on the reference workload, leaving a minute of margin
against the ten-minute promise. Large source packs may exceed the service level; the UI gives
Day 1 priority and discloses that the remainder is still compiling.

## Idempotency

Compilation is keyed. `POST /api/gaps/:id/compile` requires an idempotency key; repeating it
returns the existing run instead of starting a second one. Each generation step records
`(run, step name, input version)` and is safe to re-run: it either finds its output already
present and returns it, or produces it exactly once. Worker restarts mid-run must not duplicate
lessons, questions, audio, or provider charges.

## API surface

| Method and route | Purpose |
| --- | --- |
| `POST /api/gaps` | create and normalise a gap |
| `PATCH /api/gaps/:id` | confirm or edit the definition |
| `POST /api/gaps/:id/sources` | register an upload |
| `POST /api/gaps/:id/diagnostic` | submit diagnostic answers |
| `POST /api/gaps/:id/compile` | start an idempotent compilation |
| `GET /api/runs/:id` | pipeline status |
| `GET /api/runs/:id/events` | stream stage progress |
| `GET /api/gaps/:id/curriculum` | current curriculum |
| `GET /api/today` | due learning and reviews |
| `POST /api/attempts` | submit one practice attempt |
| `POST /api/sessions/:id/complete` | complete a daily session |
| `POST /api/gaps/:id/mastery-check` | start or submit the final check |
| `GET /api/capabilities` | search filled gaps |
| `GET /api/capabilities/:id` | retained artefacts and evidence |

Contract rules: publish OpenAPI; validate every request and response at runtime; opaque
identifiers only; idempotency keys required on compile and attempt writes; stable machine-readable
error codes; never expose provider prompts, credentials or internal reasoning; every generated
structured object carries a schema version.
