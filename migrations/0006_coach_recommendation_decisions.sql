PRAGMA foreign_keys = ON;

CREATE TABLE coach_recommendation_decisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  review_id TEXT NOT NULL REFERENCES daily_reviews(id) ON DELETE CASCADE,
  recommendation_index INTEGER NOT NULL,
  recommendation_json TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('applied', 'dismissed')),
  schedule_item_id TEXT REFERENCES schedule_items(id) ON DELETE SET NULL,
  scheduled_date TEXT,
  before_type TEXT,
  before_target TEXT,
  after_type TEXT,
  after_target TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (review_id, recommendation_index, recommendation_json)
);

CREATE INDEX coach_recommendation_decisions_review_id_idx
  ON coach_recommendation_decisions(review_id, recommendation_index);
