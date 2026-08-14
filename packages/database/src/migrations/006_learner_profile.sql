-- 006: learner profile (E24 US4, R7).
--
-- The curriculum is a function of gap + sources + diagnostic + learner profile + mastery
-- evidence (constitution §1). The profile fields — preferred lesson length and stated goals —
-- shape the plan (FR-019): short/standard/long lesson length rescales the daily structure and
-- goals are rendered into the learner brief. Defaults keep every existing user valid:
-- 'standard' length, no goals. The CHECK constraint mirrors the repository-layer validation,
-- so an invalid lesson length can never reach the planner through SQL either.
--
-- Forward-only: shipped migrations are never edited; this adds to 001-005.

ALTER TABLE users ADD COLUMN preferred_lesson_length TEXT NOT NULL DEFAULT 'standard'
  CHECK (preferred_lesson_length IN ('short', 'standard', 'long'));
ALTER TABLE users ADD COLUMN goals JSONB NOT NULL DEFAULT '[]'::jsonb;
