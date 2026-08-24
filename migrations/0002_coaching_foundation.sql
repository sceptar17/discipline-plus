PRAGMA foreign_keys = ON;

CREATE TABLE daily_health (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  calories_kcal REAL,
  protein_g REAL,
  carbs_g REAL,
  fat_g REAL,
  steps INTEGER CHECK (steps IS NULL OR steps >= 0),
  nutrition_source TEXT NOT NULL DEFAULT 'manual',
  steps_source TEXT NOT NULL DEFAULT 'manual',
  synced_at TEXT,
  provenance TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, date)
);

CREATE TABLE body_weight_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  measured_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  weight_lb REAL NOT NULL CHECK (weight_lb > 0),
  source TEXT NOT NULL DEFAULT 'manual',
  source_record_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE coaching_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  goal_name TEXT NOT NULL,
  start_weight_lb REAL,
  height_inches REAL,
  target_weight_lb REAL,
  desired_loss_min_lb REAL,
  desired_loss_max_lb REAL,
  targets TEXT NOT NULL DEFAULT '{}',
  equipment TEXT NOT NULL DEFAULT '',
  calorie_context TEXT NOT NULL DEFAULT '',
  coaching_style TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE coaching_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  exercise_id TEXT REFERENCES exercises(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'superseded')),
  priority INTEGER NOT NULL DEFAULT 0,
  effective_from TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX daily_health_user_id_date_idx ON daily_health(user_id, date);
CREATE INDEX body_weight_user_id_local_date_idx ON body_weight_entries(user_id, local_date, measured_at);
CREATE UNIQUE INDEX body_weight_source_record_unique
  ON body_weight_entries(user_id, source, source_record_id)
  WHERE source_record_id IS NOT NULL;
CREATE INDEX coaching_notes_user_id_status_idx ON coaching_notes(user_id, status);
