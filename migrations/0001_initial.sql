PRAGMA foreign_keys = ON;

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE exercises (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'exercise' CHECK (kind IN ('exercise', 'habit')),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  equipment TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  default_type TEXT NOT NULL CHECK (default_type IN ('count', 'sets', 'duration', 'distance', 'for-time', 'weighted')),
  allowed TEXT NOT NULL DEFAULT '[]',
  target TEXT NOT NULL DEFAULT '{}',
  refs TEXT NOT NULL DEFAULT '[]',
  progress_metric TEXT NOT NULL CHECK (progress_metric IN ('count', 'time', 'weight')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  focus TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE plan_days (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (plan_id, day_number)
);

CREATE TABLE plan_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_day_id TEXT NOT NULL REFERENCES plan_days(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('count', 'sets', 'duration', 'distance', 'for-time', 'weighted')),
  target TEXT NOT NULL DEFAULT '{}',
  ref TEXT NOT NULL CHECK (ref IN ('last-result', 'personal-best')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
  start_date TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE schedule_days (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  skipped INTEGER NOT NULL DEFAULT 0 CHECK (skipped IN (0, 1)),
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  day_no INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, date)
);

CREATE TABLE schedule_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  schedule_day_id TEXT NOT NULL REFERENCES schedule_days(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('count', 'sets', 'duration', 'distance', 'for-time', 'weighted')),
  target TEXT NOT NULL DEFAULT '{}',
  ref TEXT NOT NULL CHECK (ref IN ('last-result', 'personal-best')),
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  result TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source_item_id TEXT REFERENCES schedule_items(id) ON DELETE SET NULL,
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('count', 'sets', 'duration', 'distance', 'for-time', 'weighted')),
  target TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX logs_source_item_id_unique ON logs(source_item_id) WHERE source_item_id IS NOT NULL;
CREATE INDEX exercises_user_id_name_idx ON exercises(user_id, name);
CREATE INDEX plans_user_id_name_idx ON plans(user_id, name);
CREATE INDEX plan_days_plan_id_day_number_idx ON plan_days(plan_id, day_number);
CREATE INDEX plan_items_plan_day_id_idx ON plan_items(plan_day_id);
CREATE INDEX runs_user_id_start_date_idx ON runs(user_id, start_date);
CREATE INDEX schedule_days_user_id_date_idx ON schedule_days(user_id, date);
CREATE INDEX schedule_items_schedule_day_id_idx ON schedule_items(schedule_day_id);
CREATE INDEX logs_user_id_exercise_id_date_idx ON logs(user_id, exercise_id, date);
