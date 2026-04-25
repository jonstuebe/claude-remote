import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import { detectCurrentBranch } from "../git.ts";
import type { Project } from "../projects/registry.ts";

export type ConversationStatus = "active" | "orphaned" | "archived";

export type Conversation = {
  id: string;
  project_id: string;
  worktree_path: string;
  branch: string;
  session_id: string | null;
  title: string;
  color: string | null;
  is_default: boolean;
  status: ConversationStatus;
  created_at: string;
  last_active_at: string;
};

export class ConversationNotFoundError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`No conversation with id "${id}"`);
    this.name = "ConversationNotFoundError";
    this.id = id;
  }
}

const CONVERSATION_COLUMNS =
  "id, project_id, worktree_path, branch, session_id, title, color, is_default, status, created_at, last_active_at";

function rowToConversation(row: Record<string, unknown>): Conversation {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    worktree_path: row.worktree_path as string,
    branch: row.branch as string,
    session_id: (row.session_id as string | null) ?? null,
    title: row.title as string,
    color: (row.color as string | null) ?? null,
    is_default: (row.is_default as number) === 1,
    status: row.status as ConversationStatus,
    created_at: row.created_at as string,
    last_active_at: row.last_active_at as string,
  };
}

function getDefaultConversation(db: Database, projectId: string): Conversation | null {
  const row = db
    .prepare<Record<string, unknown>, [string]>(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversations
       WHERE project_id = ? AND is_default = 1 LIMIT 1`,
    )
    .get(projectId);
  return row ? rowToConversation(row) : null;
}

export async function ensureDefaultConversation(
  db: Database,
  project: Project,
): Promise<Conversation> {
  const existing = getDefaultConversation(db, project.id);
  if (existing) return existing;

  const branch = (await detectCurrentBranch(project.repo_path)) ?? project.default_branch;
  const now = new Date().toISOString();
  const conversation: Conversation = {
    id: randomUUID(),
    project_id: project.id,
    worktree_path: project.repo_path,
    branch,
    session_id: null,
    title: project.name,
    color: null,
    is_default: true,
    status: "active",
    created_at: now,
    last_active_at: now,
  };

  db.run(
    `INSERT INTO conversations (${CONVERSATION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      conversation.id,
      conversation.project_id,
      conversation.worktree_path,
      conversation.branch,
      conversation.session_id,
      conversation.title,
      conversation.color,
      conversation.is_default ? 1 : 0,
      conversation.status,
      conversation.created_at,
      conversation.last_active_at,
    ],
  );

  return conversation;
}

export function listConversations(db: Database, projectId: string): Conversation[] {
  const rows = db
    .prepare<Record<string, unknown>, [string]>(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversations
       WHERE project_id = ?
       ORDER BY is_default DESC, last_active_at DESC`,
    )
    .all(projectId);
  return rows.map(rowToConversation);
}

export function getConversation(db: Database, id: string): Conversation | null {
  const row = db
    .prepare<Record<string, unknown>, [string]>(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = ?`,
    )
    .get(id);
  return row ? rowToConversation(row) : null;
}
