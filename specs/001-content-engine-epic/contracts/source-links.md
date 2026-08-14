# C-07 Source-link affordance

**Serves**: US2 (FR-011, SC-006: traceability is user-visible; the only new user-facing surface
this epic ships). **Status**: new surface.

## Purpose

A learner can see, next to every published lesson and every practice question, the source
locator(s) behind it, and reach the supporting source in one step.

## Shape

`apps/web/src/app/gaps/[gapId]/study/page.tsx` (server component, already resolves
`question.payload.evidence.locators` into `AttemptQuestion.locators` with source names):

- **Lesson (Listen section)**: render the lesson package's `evidence.locators` as locator links
  under the player card — `Source · §2.3` → `/gaps/{gapId}?tab=sources#chunk-{chunkId}`.
- **Question (pre-answer)**: render each question's locators inside the question card
  (`apps/web/src/components/attempt-form.tsx`), visible before the attempt, not only in the
  post-answer correction surface (`apps/web/src/components/practice-feedback.tsx`, unchanged).
- Shared component `apps/web/src/components/source-links.tsx` (links + a11y: real `<a>`, visible
  focus, `aria-label="Open source §2.3 in the Sources tab"`); the Sources tab
  (`apps/web/src/app/gaps/[gapId]/page.tsx?tab=sources`) already renders locator chips — add
  `id="chunk-{chunkId}"` anchors on chunk rows so the links resolve one step away.
- General-knowledge items render the explicit label "General knowledge" instead of a link
  (FR-008's labelling is user-visible too).

## Validation

- Component test in `apps/web/src/components/screens.test.tsx`: a published lesson renders
  locator links in Listen and per-question; a general-knowledge item renders the label; every
  link targets `/gaps/{gapId}?tab=sources#chunk-…`; focus-visible rule present (quality.md §2).
- Server-render smoke (existing pattern) for a seeded compiled gap.
- No API/route change: the study page already fetches `getLesson` + `listSources`
  (`apps/web/src/server/api.ts`).
