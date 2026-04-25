CREATE TABLE projects (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  repo_path        TEXT NOT NULL UNIQUE,
  default_branch   TEXT NOT NULL,
  worktree_root    TEXT NOT NULL,
  permissions_mode TEXT NOT NULL DEFAULT 'bypassPermissions'
                   CHECK (permissions_mode IN ('bypassPermissions', 'acceptEdits')),
  created_at       TEXT NOT NULL
) STRICT;

CREATE TABLE conversations (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  worktree_path   TEXT NOT NULL,
  branch          TEXT NOT NULL,
  session_id      TEXT,
  title           TEXT NOT NULL,
  color           TEXT,
  is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'orphaned', 'archived')),
  created_at      TEXT NOT NULL,
  last_active_at  TEXT NOT NULL,
  UNIQUE (project_id, worktree_path)
) STRICT;

CREATE UNIQUE INDEX conversations_one_default_per_project
  ON conversations (project_id)
  WHERE is_default = 1;

CREATE INDEX conversations_by_project_recency
  ON conversations (project_id, last_active_at DESC);

CREATE TABLE session_ledger (
  conversation_id TEXT PRIMARY KEY
                  REFERENCES conversations(id) ON DELETE CASCADE,
  sdk_session_id  TEXT NOT NULL,
  host_pid        INTEGER NOT NULL,
  started_at      TEXT NOT NULL
) STRICT;
