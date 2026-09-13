-- GAPX-04: atomic per-owner request counters. Additive; rollback is a later forward-only drop.

CREATE TABLE request_quotas (
  owner_id text NOT NULL,
  operation text NOT NULL,
  window_started_at timestamptz NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (owner_id, operation, window_started_at)
);

ALTER TABLE request_quotas
  ADD CONSTRAINT request_quotas_operation_check
  CHECK (operation IN ('upload', 'compile', 'proof'));

ALTER TABLE request_quotas
  ADD CONSTRAINT request_quotas_count_check
  CHECK (count >= 0);
