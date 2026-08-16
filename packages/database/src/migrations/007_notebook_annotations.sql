-- 007: notebook annotations (E25 / GAP-085).
--
-- The explain layer lets the learner select a word/sentence in a lesson, get an AI
-- explanation, and pin it into the notebook. Annotations are owner-scoped like every
-- learner record (constitution §8), tied to a lesson, and carry the selected text so
-- the notebook can render the callout in context. Forward-only: shipped migrations
-- are never edited; this adds to 001-006.

CREATE TABLE notebook_annotations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL,
  selection TEXT NOT NULL,
  explanation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, lesson_id, selection)
);

CREATE INDEX notebook_annotations_lesson_idx
  ON notebook_annotations (owner_id, lesson_id);
