PRAGMA foreign_keys = ON;

CREATE TABLE schedule_versions (
  user_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE request_rate_limits (
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  window_key TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, action, window_key)
);

ALTER TABLE mobile_devices ADD COLUMN expires_at TEXT;
UPDATE mobile_devices
SET expires_at = datetime(COALESCE(created_at, 'now'), '+365 days')
WHERE expires_at IS NULL;

CREATE INDEX request_rate_limits_updated_idx ON request_rate_limits(updated_at);
