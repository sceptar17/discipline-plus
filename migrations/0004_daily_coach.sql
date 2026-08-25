PRAGMA foreign_keys = ON;

CREATE TABLE daily_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  model TEXT NOT NULL,
  headline TEXT NOT NULL,
  review_text TEXT NOT NULL,
  structured_review TEXT NOT NULL DEFAULT '{}',
  context_snapshot TEXT NOT NULL DEFAULT '{}',
  openai_response_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, date)
);

CREATE TABLE coach_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  review_id TEXT NOT NULL REFERENCES daily_reviews(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  openai_response_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX daily_reviews_user_id_date_idx ON daily_reviews(user_id, date DESC);
CREATE INDEX coach_messages_review_id_created_at_idx ON coach_messages(review_id, created_at);
