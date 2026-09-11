PRAGMA foreign_keys = ON;

CREATE TABLE program_coach_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Program coach',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX program_coach_one_active_conversation_idx
  ON program_coach_conversations(user_id)
  WHERE status = 'active';

CREATE TABLE program_coach_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES program_coach_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  lookback_days INTEGER NOT NULL CHECK (lookback_days IN (28, 56, 84)),
  context_snapshot TEXT,
  openai_response_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX program_coach_messages_conversation_created_idx
  ON program_coach_messages(conversation_id, created_at);
