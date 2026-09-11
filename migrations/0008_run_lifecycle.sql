ALTER TABLE runs ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed'));
ALTER TABLE runs ADD COLUMN completed_at TEXT;

CREATE INDEX runs_user_id_status_start_date_idx
  ON runs(user_id, status, start_date);
