-- 006: Arc learner surface (GAP-032).
--
-- Three additive changes for the Arc UI:
--   * the notebook proof question type joins the question set — the implicit CHECK constraint
--     on questions.type is rebuilt to admit 'code_proof' (Postgres names it questions_type_check);
--   * learner_preferences holds the Profile toggles (audio theory, gentle hints, dark mode,
--     spaced review). Spaced review is wired to real review scheduling: the Today view hides
--     due reviews while the toggle is off, without cancelling the schedule itself;
--   * arc_calibrations records each 3-step calibration: the persisted selections, whether the
--     baseline answer was correct, and the schema-validated diagnostic interpretation (the
--     gaps identified and the adaptive starting difficulty) that mapped to the created gap.
--
-- Forward-only: shipped migrations are never edited; this adds to 001-005.

ALTER TABLE questions DROP CONSTRAINT questions_type_check;
ALTER TABLE questions ADD CONSTRAINT questions_type_check
  CHECK (type IN ('multiple_choice', 'short_answer', 'worked_problem', 'code_proof'));

CREATE TABLE IF NOT EXISTS learner_preferences (
  owner_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  audio_theory  BOOLEAN NOT NULL DEFAULT true,
  gentle_hints  BOOLEAN NOT NULL DEFAULT true,
  dark_mode     BOOLEAN NOT NULL DEFAULT false,
  spaced_review BOOLEAN NOT NULL DEFAULT false,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arc_calibrations (
  id                  TEXT PRIMARY KEY,
  owner_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gap_id              TEXT NOT NULL REFERENCES gaps(id) ON DELETE CASCADE,
  subject             TEXT NOT NULL,
  goal                TEXT NOT NULL,
  baseline_answer     TEXT NOT NULL,
  baseline_correct    BOOLEAN NOT NULL,
  -- The schema-validated diagnostic interpretation that produced the gap list.
  gaps_identified     JSONB NOT NULL DEFAULT '[]'::jsonb,
  starting_difficulty INTEGER NOT NULL DEFAULT 2,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calibrations_owner_idx ON arc_calibrations (owner_id, created_at);
