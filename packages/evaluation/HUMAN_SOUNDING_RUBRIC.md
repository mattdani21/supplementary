# The Human-Sounding Rubric (E24 US1, C-02)

**Status**: published | **Owner**: `packages/evaluation` + `packages/domain/src/curriculum/script-structure.ts`

"Lessons read like a human teacher, not a model dump" (constitution §3, `specs/quality.md` §10,
FR-005/FR-006). This is the contract that makes that sentence checkable: the four structural
elements, the deterministic detection rules, the floor, and the calibration record.

## What the four elements mean to a human reviewer

A lesson that reads like a real teacher:

1. **Concrete opening** — it starts with a situation, question, or problem the learner
   recognises ("A relation is nothing more mysterious than a set of ordered pairs."), never with
   a statement about the lesson, the curriculum, or the generation process ("In this lesson we
   will cover…", "Today we will learn about…", "Welcome to…").
2. **One idea per segment** — it builds one idea at a time. Each segment (paragraph, or sentence
   in a spoken script) is a complete sentence that teaches a single step; it is not a bulleted or
   enumerated list, which cannot be taught aloud.
3. **Worked example** — it works a real problem step by step *inside the script* (FR-003), not
   merely references one: either a declared example whose text appears in the script, or a
   step-by-step block ("first … second …", "Reflexive: … Symmetric: … Transitive: …").
4. **Checkpoint question** — it stops and asks the learner something (FR-004): the lesson
   declares a pause prompt and the script actually asks that question, so the pause is part of
   the teaching, and playback requires a response before continuing.

## Deterministic detection rules

Single source of truth: `packages/domain/src/curriculum/script-structure.ts`, consumed by both
the evaluation scorer (`scoreHumanSounding`) and the domain verifier (`checkLessonStructure`) so
scoring and verification can never disagree.

| Element | Rule |
|---|---|
| `concrete_opening` | First sentence must not match a meta-opening pattern (`in this lesson`, `this lesson will`, `in this chapter`, `today we will`, `we will cover`, `welcome to`, `let's/let us learn about`, `this module`, `the lesson`, `the course`, `the generation`) after normalisation, and must be ≥ 5 words with a concrete subject. |
| `single_idea_per_segment` | Script split into paragraphs (fallback: sentences, since a spoken script is one paragraph by design); ≥ 2 segments; every segment ends with terminal punctuation; no segment starts with a list marker (`-`, `*`, `•`, `1.`). |
| `worked_example` | A declared `examples` entry whose normalised text appears in the script, **or** a step-by-step block: ≥ 2 distinct step markers (`first|second|third|next|then|step`) or ≥ 2 sentence-initial labelled steps (`Word: …`). |
| `checkpoint` | `pausePrompts.length ≥ 1` and the first prompt's text appears (normalised) in the script. |

Deliberately conservative: a false accusation fails a correct lesson, which is worse than a
missed one. Every rule errs towards *passing* content that could plausibly be human teaching.

## The floor

`SCORE_FLOORS.human_sounding = 0.75` in `packages/evaluation/src/fixture.ts`.

The dimension score is the **share of lessons that pass all four checks**. A score below 0.75
fails the evaluation gate. Because the score is per-lesson AND-of-four, a single missing element
in every lesson scores 0 — the four degradation cases in
`tests/evaluation/reference-pack.test.ts` (meta-opening, list-like prose, no worked example, no
checkpoint) each score below the floor with the failing element named (FR-006).

## Calibration record (T015)

Calibrated against the reference curricula on 2026-08-14 (fake provider, `eval_01`):

- Reference lessons: days 1–3 of `packages/test-fixtures/src/reference-curriculum.ts`
  (`referenceLesson(1..3)`).
- Calibration command: `env -u GAPOS_PROVIDER_MODE -u GAPOS_LLM_MODEL pnpm exec vitest run tests/evaluation/reference-pack.test.ts`
- Result: every reference lesson passes all four checks → `human_sounding` score **1.0**,
  above the 0.75 floor (SC-002). Each of the four degradation cases scores **0** — below the
  floor — and its observation names the missing element.
- Fixture alignment note: the reference `pausePrompts` were aligned so each lesson's checkpoint
  question is asked verbatim inside its script (FR-004 fidelity — a checkpoint the lesson never
  asks would be a fixture bug), and `referenceLesson` now carries day-specific pause prompts.
  Evidence recorded in `tasks/status.json` under E24-T015.

Baseline for the live gate is recorded in `tasks/evaluation-baselines.json` (US5, T037).
