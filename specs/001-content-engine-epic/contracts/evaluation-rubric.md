# C-01 Evaluation dimension `human_sounding` + C-02 Human-sounding rubric

**Serves**: US1 (script quality), US5 (regression gate). **Status**: new.

## Purpose

The quality contract for "lessons read like a human teacher, not a model dump"
(constitution §3, `specs/quality.md` §10, FR-005/FR-006). Every published lesson script on the
reference packs must clear the floor; a deliberately degraded model-dump script must fall below
it with the failing element named.

## Shape

`packages/evaluation/src/fixture.ts`:

```ts
export const SCORE_DIMENSIONS = [ ..., 'human_sounding' ] as const; // appended, never reordered
export const SCORE_FLOORS: Readonly<Record<ScoreDimension, number>> = { ..., human_sounding: <calibrated> };
```

`packages/domain/src/curriculum/script-structure.ts` — the four element detectors, exported
from `packages/domain/src/index.ts` (the single source of truth; `@gapos/evaluation` already
depends on `@gapos/domain`, so the scorer imports them without a cycle). The domain verifier
(`checkLessonStructure`, C-03) consumes the same functions.

`packages/evaluation/src/scorer.ts` — new `scoreHumanSounding(produced): DimensionScore`:
per-lesson binary checks (0/1 each), dimension score = share of lessons passing all four:

1. **concrete_opening** — first sentence does not match meta-opening patterns (`in this lesson`,
   `this lesson will`, `in this chapter`, `today we will`, `we will cover`, `welcome to`,
   `let's learn about`, `this module`, `the lesson`, `the course`, `the generation`) and is ≥ 5
   words with a concrete subject.
2. **single_idea_per_segment** — script split into segments (paragraphs, else sentences); every
   segment ends with terminal punctuation; no segment starts with a list marker (`-`, `*`, `•`,
   `1.`); ≥ 2 segments.
3. **worked_example** — `examples` has an entry of ≥ 2 sentences whose text appears (normalised)
   inside the script (worked *within* the script, FR-003), or the script contains a
   step-by-step block (`step`, `first … then`, enumerated sequence).
4. **checkpoint** — `pausePrompts.length ≥ 1` and the first prompt's text appears in the script.

Observations name the failing element (`Day N missing concrete opening: "<first sentence>"`).

## Published rubric

`packages/evaluation/HUMAN_SOUNDING_RUBRIC.md` — the prose rubric (what each element means to a
human reviewer), the deterministic detection rules above, the floor, and the calibration record
(scores of the reference curricula at calibration time, `tasks/status.json` evidence).

## Validation

- Floor calibrated from the reference curricula (deterministic `referenceLesson` fixtures,
  `packages/test-fixtures/src/reference-curriculum.ts`) and recorded in
  `tasks/evaluation-baselines.json` via `scripts/record-eval-baselines.ts` (R10).
- Degradation tests in `tests/evaluation/reference-pack.test.ts`: meta-opening, list-like prose,
  no worked example, no checkpoint → `score < floor` and the observation names the element
  (FR-006, SC-002).
- Gate test: `eval_01` reference curriculum clears the floor (SC-002).
