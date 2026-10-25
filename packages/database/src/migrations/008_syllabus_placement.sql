-- 008: Syllabus placement loop (GAP-038).
--
-- Catalog syllabi live as code fixtures; imported outlines and every learner enrollment are
-- persisted here. Placement attempts store the graded result (never the answer key as a
-- client-readable column — keys stay in the ephemeral kit store). Remediation rows bind an
-- unmet objective to a spawned gap with an idempotency key so retries cannot duplicate courses.
--
-- Forward-only: shipped migrations are never edited.

CREATE TABLE IF NOT EXISTS imported_syllabi (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL DEFAULT 1,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  -- Schema-validated Syllabus value (source = imported).
  syllabus     JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS imported_syllabi_owner_idx ON imported_syllabi (owner_id, created_at);

CREATE TABLE IF NOT EXISTS syllabus_enrollments (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  syllabus_id       TEXT NOT NULL,
  syllabus_version  INTEGER NOT NULL,
  syllabus_source   TEXT NOT NULL CHECK (syllabus_source IN ('catalog', 'imported')),
  -- Snapshot of the Syllabus at enrollment time so version changes cannot rewrite history.
  syllabus_snapshot JSONB NOT NULL,
  status            TEXT NOT NULL CHECK (status IN (
                      'enrolled', 'placing', 'remediating', 'placed', 'completed'
                    )),
  unlocked_modules  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS syllabus_enrollments_owner_idx
  ON syllabus_enrollments (owner_id, created_at);

CREATE TABLE IF NOT EXISTS placement_attempts (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrollment_id  TEXT NOT NULL REFERENCES syllabus_enrollments(id) ON DELETE CASCADE,
  kit_id         TEXT NOT NULL,
  -- Submitted answers only (itemId → response). Answer keys are never stored here.
  answers        JSONB NOT NULL,
  -- PlacementResult from the domain grader.
  result         JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS placement_attempts_owner_enrollment_idx
  ON placement_attempts (owner_id, enrollment_id, created_at);

CREATE TABLE IF NOT EXISTS syllabus_remediations (
  id               TEXT PRIMARY KEY,
  owner_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrollment_id    TEXT NOT NULL REFERENCES syllabus_enrollments(id) ON DELETE CASCADE,
  placement_attempt_id TEXT NOT NULL REFERENCES placement_attempts(id) ON DELETE CASCADE,
  objective_id     TEXT NOT NULL,
  gap_id           TEXT NOT NULL REFERENCES gaps(id) ON DELETE CASCADE,
  idempotency_key  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS syllabus_remediations_owner_enrollment_idx
  ON syllabus_remediations (owner_id, enrollment_id);
