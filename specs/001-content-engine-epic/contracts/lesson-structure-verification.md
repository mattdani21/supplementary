# C-03 Lesson structure verification

**Serves**: US1 (FR-007: verify before publication). **Status**: new finding category.

## Purpose

The pipeline must not ship a lesson script missing a structural element: missing → repaired (≤
2 attempts) or excluded via the existing `decideRepair` loop.

## Shape

`packages/domain/src/verification/verifier.ts`:

```ts
export type FindingCategory = ... | 'script_structure';
export const checkLessonStructure = (lesson: VerifiableLesson): Finding[];
```

- One finding per missing element, `severity: 'critical'`, `targetId: lesson.id`, message naming
  the element (`Day 2 script has no checkpoint question.` / `Day 2 script opens with a statement
  about the lesson.` / `Day 2 script contains no worked example.` / `Day 2 script has a
  segment that is not a complete sentence.`), with `suggestedRepair` per element.
- Reuses the exact element detectors from C-02: the single source of truth is
  `packages/domain/src/curriculum/script-structure.ts` (exported from `packages/domain/src/index.ts`),
  imported by both the domain verifier and the evaluation scorer (`@gapos/evaluation` already
  depends on `@gapos/domain`; the reverse edge would be a cycle).

`packages/ai-contracts/src/contracts.ts` — `VERIFICATION_CATEGORIES` gains
`'script_structure'` (the verification-report contract's category enum, which the domain
`FindingCategory` mirrors); regenerate `specs/generation-schemas/verification_report.v1-0-0.json`
with `pnpm specs:generate`.

## Validation

- `packages/domain/src/verification/verifier.test.ts`: a lesson missing any element produces a
  `script_structure` critical finding; a lesson with all four elements produces none.
- Pipeline-level (fake provider): a scripted faulty lesson (missing checkpoint) is repaired or
  excluded, never published — asserted in `apps/worker`/`tests/end-to-end` compile test.
- `tests/architecture/specs.test.ts` continues to pass after regeneration.
