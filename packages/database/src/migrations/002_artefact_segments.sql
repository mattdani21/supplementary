-- 002_artefact_segments
--
-- Fixes a constraint that silently disabled audio on Postgres.
--
-- 001 declared UNIQUE (lesson_id, kind, version) on artefacts, which encodes the assumption that
-- a lesson has one artefact of each kind. That is true for a transcript and false for audio: a
-- lesson script is synthesised as several segments so they can be generated in parallel, retried
-- individually, and cut on pause prompts. Every segment is kind='audio' at version 1, so the
-- second insert violated the constraint.
--
-- The failure was invisible in the worst way. The insert threw, the pipeline's audio fallback
-- caught it and degraded the lesson to transcript-only, and the run still reported success — so
-- an audio-first product shipped without audio, and only a warning line said so. The in-memory
-- store has no constraints, so no test caught the divergence until the same contract suite ran
-- against both.
--
-- Forward-only: 001 has shipped and is not edited.

ALTER TABLE artefacts ADD COLUMN IF NOT EXISTS segment_ordinal INTEGER NOT NULL DEFAULT 0;

ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_lesson_id_kind_version_key;

-- One row per (lesson, kind, version, segment). A transcript stays at segment 0; audio counts up.
ALTER TABLE artefacts
  ADD CONSTRAINT artefacts_lesson_kind_version_segment_key
  UNIQUE (lesson_id, kind, version, segment_ordinal);

-- Playback reads segments in order, so the index matches the query.
CREATE INDEX IF NOT EXISTS artefacts_playback_idx
  ON artefacts (owner_id, lesson_id, kind, segment_ordinal);
