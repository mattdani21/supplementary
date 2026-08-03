-- 005: educator review (E19).
--
-- A reviewer's decision about a lesson is recorded on the lesson itself: a flag (the run's
-- audit findings) puts a lesson in the review queue; the decision is 'approved' or 'rejected'
-- with an optional note. The note is shown to the learner on the lesson page.
--
-- Forward-only: shipped migrations are never edited; this adds to 001-004.

ALTER TABLE lessons ADD COLUMN review_status TEXT;
ALTER TABLE lessons ADD COLUMN review_note TEXT;

CREATE INDEX IF NOT EXISTS lessons_review_status_idx ON lessons (owner_id, review_status);
