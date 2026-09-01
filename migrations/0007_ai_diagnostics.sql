PRAGMA foreign_keys = ON;

CREATE TABLE ai_diagnostics (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('daily_review', 'coach_message')),
  review_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  model TEXT NOT NULL,
  provider_status INTEGER,
  error_code TEXT,
  message TEXT NOT NULL,
  request_id TEXT,
  response_id TEXT,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX ai_diagnostics_user_created_idx
  ON ai_diagnostics(user_id, created_at DESC);
