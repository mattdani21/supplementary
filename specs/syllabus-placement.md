# Syllabus placement loop

Contract for catalog libraries and learner-imported outlines. Behaviour starts here and in
`docs/PRODUCT.md`; code must satisfy the acceptance criteria below with automated checks.

## Objects

### Syllabus

A versioned, ordered course structure. Same shape for catalog libraries and imported outlines.

| Field | Rule |
| --- | --- |
| `id` | Stable identity (`catalog:machine-learning` or an imported uuid) |
| `version` | Positive integer; placement and spawn keys bind to this version |
| `title`, `description` | Non-empty |
| `source` | `catalog` or `imported` |
| `modules` | Ordered modules with unique ids; each references one or more objectives |
| `objectives` | Measurable statements with unique ids; prerequisites must exist and form a DAG |

Validation refuses empty modules, unknown objective references, prerequisite cycles, and
duplicate ids.

### Placement kit

Multi-item exam bound to a syllabus version. Each item targets one objective. The answer key
never leaves the server; the client receives an opaque `kitId` and item prompts only.

### Placement result

Per objective: `placed` or `unmet`. Modules unlock only when every required objective on that
module and all of its prerequisite objectives are `placed`. The learner is not routed onto a
later module they have not unlocked.

### Spawn plan

Each unmet required objective yields exactly one supplementary gap. The idempotency key is
`owner + syllabusId + syllabusVersion + objectiveId`. Retrying spawn after a partial failure
reuses the existing gap rather than creating a second.

### Re-sit gate

A new placement kit is issued only when every spawned supplementary gap for the current
enrollment is `filled` under the existing mastery rule. Until then the API returns
`placement_resit_blocked` with the unfinished gap ids.

## Journeys

1. **Catalog.** Learner opens the catalog → selects Machine Learning → starts placement →
   receives unmet objectives → supplementary courses spawn → clears them → re-sits → places
   into unlocked modules.
2. **Import.** Learner pastes a structured outline (`title`, modules with `title` + outcome
   strings) → validated into a Syllabus → same placement loop. Free-form PDF parsing is out of
   scope.

## HTTP surface (under `/api`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/arc/catalog` | Catalog syllabi (fixture libraries) |
| POST | `/arc/syllabi/import` | Import a structured outline |
| POST | `/arc/syllabi/{syllabusId}/enroll` | Begin an enrollment |
| GET | `/arc/enrollments/{enrollmentId}` | Enrollment status, unlocked modules, spawned gaps |
| GET | `/arc/enrollments/{enrollmentId}/placement` | Issue a placement kit (answer key withheld) |
| POST | `/arc/enrollments/{enrollmentId}/placement` | Submit answers; spawn unmet courses |
| POST | `/arc/enrollments/{enrollmentId}/resit` | Request a new kit when remediations are filled |

## Acceptance criteria

1. A Machine Learning catalog syllabus validates and appears in `GET /arc/catalog`.
2. Placement grades server-side; forged client answers cannot mark an unmet objective placed.
3. Unmet required objectives spawn gaps idempotently; a second spawn call returns the same gap ids.
4. Re-sit is refused while any spawned gap is not `filled`; after all are filled, a new kit issues.
5. A structured outline import validates into the same Syllabus shape and supports the same loop.
6. Arc screens exist for catalog, placement, spawned gaps, and re-sit, using the Arc design system.
7. `pnpm verify` is green; domain tests cover validation, grading, spawn idempotency, and the re-sit gate.

## Non-goals

Diagram / 3D artefacts, arbitrary PDF syllabus parsing, public signup, visual redesign of legacy
`/gaps` pages, changing mastery thresholds.
