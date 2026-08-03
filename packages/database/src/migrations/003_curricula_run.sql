-- 003: curricula belong to the generation run that produced them (GAP-015).
--
-- A worker crash mid-run is recovered by re-entering the SAME run: the run's recorded steps are
-- reused, so no lesson, audio or provider charge is duplicated. For that, the run's curriculum
-- must be re-entered too — not recreated. And a retry after a late failure starts a NEW run,
-- which legitimately produces another version-1 curriculum for the same gap, so uniqueness is
-- now per (gap, version, run) and "current" means the newest created.
--
-- Forward-only: shipped migrations are never edited; this adds to 001/002.

ALTER TABLE curricula ADD COLUMN run_id TEXT REFERENCES generation_runs(id) ON DELETE CASCADE;

ALTER TABLE curricula DROP CONSTRAINT curricula_gap_id_version_key;

CREATE INDEX IF NOT EXISTS curricula_run_idx ON curricula (owner_id, run_id);
CREATE INDEX IF NOT EXISTS curricula_gap_version_created_idx
  ON curricula (gap_id, version, created_at);
