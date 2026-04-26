-- Persist the latest token usage snapshot for each conversation so the
-- "context used" indicator survives page reloads / WebSocket reconnects.
--
-- The values come from the most recent assistant message's `message.usage`
-- block from the Agent SDK (which mirrors Anthropic's API usage object).
-- All counts are 0-default rather than nullable so the read path stays simple
-- and the indicator can render "0%" for fresh conversations.

ALTER TABLE conversations
  ADD COLUMN last_usage_input_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE conversations
  ADD COLUMN last_usage_output_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE conversations
  ADD COLUMN last_usage_cache_creation_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE conversations
  ADD COLUMN last_usage_cache_read_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE conversations
  ADD COLUMN last_usage_model TEXT;

ALTER TABLE conversations
  ADD COLUMN last_usage_at TEXT;
