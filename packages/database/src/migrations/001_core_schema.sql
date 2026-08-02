-- 001_core_schema
--
-- The core entities from docs/PRODUCT.md.
--
-- Forward-only: this file has shipped and must never be edited. Changes go in a new migration.
--
-- Two rules are enforced here rather than left to application discipline:
--   * every learner-owned table carries owner_id and is indexed on it, so an owner-scoped query
--     is the cheap path and an unscoped one is conspicuous;
--   * gap.status is constrained to the domain's status set, so a stray UPDATE cannot invent one.

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  locale          TEXT NOT NULL DEFAULT 'en',
  timezone        TEXT NOT NULL DEFAULT 'UTC',
  accessibility   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learner_profiles (
  user_id               TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  goals                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  preferred_minutes     INTEGER NOT NULL DEFAULT 30,
  baseline_domains      JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gaps (
  id                  TEXT PRIMARY KEY,
  owner_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  raw_statement       TEXT NOT NULL,
  current_state       TEXT,
  target_capability   TEXT,
  success_condition   TEXT,
  deadline            DATE,
  daily_minutes       INTEGER NOT NULL DEFAULT 30,
  source_policy       TEXT NOT NULL DEFAULT 'general_knowledge_allowed',
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'ready', 'compiling', 'active',
                                          'mastery_check', 'filled', 'review_due',
                                          'archived', 'failed')),
  assumptions         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gaps_owner_status_idx ON gaps (owner_id, status);

CREATE TABLE IF NOT EXISTS sources (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gap_id            TEXT NOT NULL REFERENCES gaps(id) ON DELETE CASCADE,
  filename          TEXT NOT NULL,
  media_type        TEXT NOT NULL,
  byte_size         BIGINT NOT NULL,
  -- Extraction is cached by checksum, so re-ingesting an identical file costs nothing.
  checksum          TEXT NOT NULL,
  storage_key       TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'pending'
                      CHECK (processing_status IN ('pending', 'extracting', 'indexed',
                                                   'rejected', 'failed')),
  rejection_code    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sources_owner_gap_idx ON sources (owner_id, gap_id);
CREATE INDEX IF NOT EXISTS sources_checksum_idx ON sources (checksum);

CREATE TABLE IF NOT EXISTS source_chunks (
  id                    TEXT PRIMARY KEY,
  owner_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id             TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  ordinal               INTEGER NOT NULL,
  text                  TEXT NOT NULL,
  -- Human-meaningful position: "§2 Subsets", "p. 12", "slide 4", "00:14:02".
  locator               TEXT NOT NULL,
  extraction_confidence REAL NOT NULL DEFAULT 1.0,
  token_estimate        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (source_id, ordinal)
);
CREATE INDEX IF NOT EXISTS source_chunks_owner_source_idx ON source_chunks (owner_id, source_id);

CREATE TABLE IF NOT EXISTS diagnostics (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gap_id        TEXT NOT NULL REFERENCES gaps(id) ON DELETE CASCADE,
  questions     JSONB NOT NULL DEFAULT '[]'::jsonb,
  responses     JSONB NOT NULL DEFAULT '[]'::jsonb,
  interpretation JSONB,
  skipped       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS diagnostics_owner_gap_idx ON diagnostics (owner_id, gap_id);

CREATE TABLE IF NOT EXISTS curricula (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gap_id          TEXT NOT NULL REFERENCES gaps(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL DEFAULT 1,
  duration_days   INTEGER NOT NULL,
  daily_minutes   INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'published', 'partial', 'superseded')),
  quality_score   REAL,
  plan            JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gap_id, version)
);
CREATE INDEX IF NOT EXISTS curricula_owner_gap_idx ON curricula (owner_id, gap_id);

CREATE TABLE IF NOT EXISTS objectives (
  id                    TEXT PRIMARY KEY,
  owner_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  curriculum_id         TEXT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
  capability_statement  TEXT NOT NULL,
  required              BOOLEAN NOT NULL DEFAULT true,
  prerequisite_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence              JSONB NOT NULL,
  UNIQUE (curriculum_id, id)
);
CREATE INDEX IF NOT EXISTS objectives_owner_curriculum_idx ON objectives (owner_id, curriculum_id);

CREATE TABLE IF NOT EXISTS lessons (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  curriculum_id     TEXT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
  day               INTEGER NOT NULL,
  ordinal           INTEGER NOT NULL DEFAULT 0,
  title             TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL,
  objective_ids     JSONB NOT NULL DEFAULT '[]'::jsonb,
  script            TEXT NOT NULL,
  transcript        TEXT NOT NULL,
  summary           TEXT NOT NULL,
  package           JSONB NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1,
  publication_status TEXT NOT NULL DEFAULT 'draft'
                      CHECK (publication_status IN ('draft', 'verified', 'published', 'excluded')),
  published_at      TIMESTAMPTZ,
  UNIQUE (curriculum_id, day, ordinal, version)
);
CREATE INDEX IF NOT EXISTS lessons_owner_curriculum_idx ON lessons (owner_id, curriculum_id);

CREATE TABLE IF NOT EXISTS artefacts (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id     TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('audio', 'transcript', 'visual')),
  storage_key   TEXT NOT NULL,
  media_type    TEXT NOT NULL,
  checksum      TEXT NOT NULL,
  duration_seconds REAL,
  version       INTEGER NOT NULL DEFAULT 1,
  -- An artefact referenced by a recorded attempt is frozen; edits create a new version.
  frozen        BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, kind, version)
);
CREATE INDEX IF NOT EXISTS artefacts_owner_lesson_idx ON artefacts (owner_id, lesson_id);

CREATE TABLE IF NOT EXISTS questions (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id     TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  objective_id  TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('multiple_choice', 'short_answer', 'worked_problem')),
  role          TEXT NOT NULL CHECK (role IN ('retrieval', 'application', 'transfer')),
  difficulty    INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  payload       JSONB NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  verified      BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS questions_owner_lesson_idx ON questions (owner_id, lesson_id);
CREATE INDEX IF NOT EXISTS questions_objective_idx ON questions (owner_id, objective_id);

CREATE TABLE IF NOT EXISTS attempts (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id     TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  session_id      TEXT NOT NULL,
  response        TEXT NOT NULL,
  correct         BOOLEAN NOT NULL,
  score           REAL NOT NULL DEFAULT 0,
  hints_used      INTEGER NOT NULL DEFAULT 0,
  confidence      TEXT CHECK (confidence IN ('low', 'medium', 'high')),
  -- Required on writes so a replayed submit cannot double-count evidence.
  idempotency_key TEXT NOT NULL,
  completed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS attempts_owner_question_idx ON attempts (owner_id, question_id);
CREATE INDEX IF NOT EXISTS attempts_owner_session_idx ON attempts (owner_id, session_id);

CREATE TABLE IF NOT EXISTS mastery_evidence (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  objective_id  TEXT NOT NULL,
  curriculum_id TEXT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
  attempt_id    TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  session_id    TEXT NOT NULL,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('retrieval', 'application', 'transfer',
                                                       'delayed_retrieval', 'cumulative')),
  score         REAL NOT NULL,
  independent   BOOLEAN NOT NULL,
  difficulty    INTEGER NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mastery_owner_objective_idx ON mastery_evidence (owner_id, objective_id);

CREATE TABLE IF NOT EXISTS review_items (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  objective_id  TEXT NOT NULL,
  question_id   TEXT REFERENCES questions(id) ON DELETE CASCADE,
  curriculum_id TEXT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
  due_at        TIMESTAMPTZ NOT NULL,
  interval_days INTEGER NOT NULL,
  state         TEXT NOT NULL DEFAULT 'scheduled'
                  CHECK (state IN ('scheduled', 'due', 'completed', 'cancelled')),
  reason        TEXT NOT NULL DEFAULT 'ladder'
                  CHECK (reason IN ('ladder', 'remediation', 'confidence_drop')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_owner_due_idx ON review_items (owner_id, state, due_at);

CREATE TABLE IF NOT EXISTS generation_runs (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gap_id          TEXT NOT NULL REFERENCES gaps(id) ON DELETE CASCADE,
  pipeline_version TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued',
  -- A repeated compile with the same key returns this run instead of starting a second one.
  idempotency_key TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  cost_millicents BIGINT NOT NULL DEFAULT 0,
  error           TEXT,
  UNIQUE (owner_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS runs_owner_gap_idx ON generation_runs (owner_id, gap_id);

CREATE TABLE IF NOT EXISTS generation_steps (
  -- The step key from the domain: run:step:subject:inputVersion.
  key           TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step          TEXT NOT NULL,
  subject       TEXT,
  input_version TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'pending'
                  CHECK (state IN ('pending', 'running', 'succeeded', 'failed')),
  attempt       INTEGER NOT NULL DEFAULT 0,
  output        JSONB,
  error         TEXT,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS steps_run_idx ON generation_steps (run_id, state);

CREATE TABLE IF NOT EXISTS audit_findings (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id        TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
  target_id     TEXT NOT NULL,
  category      TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  finding       TEXT NOT NULL,
  repair_status TEXT NOT NULL DEFAULT 'open'
                  CHECK (repair_status IN ('open', 'repaired', 'excluded', 'accepted')),
  repair_attempts INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS findings_run_idx ON audit_findings (run_id, repair_status);

CREATE TABLE IF NOT EXISTS knowledge_edges (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_capability   TEXT NOT NULL,
  to_capability     TEXT NOT NULL,
  relationship      TEXT NOT NULL CHECK (relationship IN ('prerequisite_of', 'extends', 'related')),
  confidence        REAL NOT NULL DEFAULT 0.5,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, from_capability, to_capability, relationship)
);
CREATE INDEX IF NOT EXISTS edges_owner_idx ON knowledge_edges (owner_id);

-- The durable job queue (ADR 0002). Jobs are leased, not deleted, so a worker crash returns
-- the job rather than losing it.
CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id        TEXT REFERENCES generation_runs(id) ON DELETE CASCADE,
  payload       JSONB NOT NULL,
  state         TEXT NOT NULL DEFAULT 'ready'
                  CHECK (state IN ('ready', 'leased', 'succeeded', 'failed', 'dead_letter')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  leased_until  TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs (state, available_at);

CREATE TABLE IF NOT EXISTS provider_usage (
  id                  TEXT PRIMARY KEY,
  owner_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id              TEXT REFERENCES generation_runs(id) ON DELETE CASCADE,
  purpose             TEXT NOT NULL,
  provider            TEXT NOT NULL,
  model               TEXT NOT NULL,
  contract            TEXT,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  audio_characters    INTEGER NOT NULL DEFAULT 0,
  cost_millicents     BIGINT NOT NULL DEFAULT 0,
  duration_ms         INTEGER NOT NULL DEFAULT 0,
  -- No prompt bodies: only a hash, so a cost regression can still be attributed.
  prompt_version_hash TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_owner_day_idx ON provider_usage (owner_id, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target      TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_owner_idx ON audit_log (owner_id, created_at);
