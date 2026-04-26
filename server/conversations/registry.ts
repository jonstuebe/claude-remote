import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Database } from "bun:sqlite";
import { detectCurrentBranch } from "../git.ts";
import type { Project } from "../projects/registry.ts";
import { createWorktree, WorktreeError } from "../worktrees/manager.ts";

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

export type ConversationValidationCode =
  | "invalid_mode"
  | "branch_required"
  | "worktree_in_use"
  | "worktree_create_failed";

export class ConversationValidationError extends Error {
  readonly code: ConversationValidationCode;
  readonly field: "mode" | "branch" | "base_branch" | null;
  constructor(
    code: ConversationValidationCode,
    field: "mode" | "branch" | "base_branch" | null,
    message: string,
  ) {
    super(message);
    this.name = "ConversationValidationError";
    this.code = code;
    this.field = field;
  }
}

export type CreateConversationInput =
  | { mode: "main" }
  | { mode: "new-worktree"; branch: string; base_branch?: string }
  | { mode: "existing-branch"; branch: string };

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

function isPathClaimed(db: Database, projectId: string, worktreePath: string): boolean {
  const row = db
    .prepare<{ id: string }, [string, string]>(
      "SELECT id FROM conversations WHERE project_id = ? AND worktree_path = ? LIMIT 1",
    )
    .get(projectId, worktreePath);
  return row !== null;
}

function defaultWorktreePathFor(project: Project, branch: string): string {
  return resolve(project.worktree_root, branch);
}

function insertConversation(db: Database, conversation: Conversation): void {
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
}

export async function createConversation(
  db: Database,
  project: Project,
  input: CreateConversationInput,
): Promise<Conversation> {
  let worktreePath: string;
  let branch: string;

  if (input.mode === "main") {
    worktreePath = project.repo_path;
    branch = (await detectCurrentBranch(project.repo_path)) ?? project.default_branch;
    if (isPathClaimed(db, project.id, worktreePath)) {
      throw new ConversationValidationError(
        "worktree_in_use",
        "mode",
        `Main worktree is already attached to another conversation`,
      );
    }
  } else if (input.mode === "new-worktree" || input.mode === "existing-branch") {
    const trimmed = (input.branch ?? "").trim();
    if (trimmed.length === 0) {
      throw new ConversationValidationError("branch_required", "branch", "Branch is required");
    }
    branch = trimmed;
    worktreePath = defaultWorktreePathFor(project, branch);

    if (isPathClaimed(db, project.id, worktreePath)) {
      throw new ConversationValidationError(
        "worktree_in_use",
        "branch",
        `A conversation already claims worktree path "${worktreePath}"`,
      );
    }

    try {
      if (input.mode === "new-worktree") {
        await createWorktree({
          repoPath: project.repo_path,
          worktreePath,
          branch,
          mode: "new-branch",
          baseBranch: input.base_branch?.trim() || project.default_branch,
          isClaimed: (path) => isPathClaimed(db, project.id, path),
        });
      } else {
        await createWorktree({
          repoPath: project.repo_path,
          worktreePath,
          branch,
          mode: "existing-branch",
          isClaimed: (path) => isPathClaimed(db, project.id, path),
        });
      }
    } catch (err) {
      if (err instanceof WorktreeError) {
        const field = err.code === "missing_base_branch" ? "base_branch" : "branch";
        throw new ConversationValidationError("worktree_create_failed", field, err.message);
      }
      throw err;
    }
  } else {
    throw new ConversationValidationError(
      "invalid_mode",
      "mode",
      `Unknown conversation mode: ${(input as { mode?: string }).mode ?? "(none)"}`,
    );
  }

  const now = new Date().toISOString();
  const conversation: Conversation = {
    id: randomUUID(),
    project_id: project.id,
    worktree_path: worktreePath,
    branch,
    session_id: null,
    title: input.mode === "main" ? project.name : branch,
    color: null,
    is_default: false,
    status: "active",
    created_at: now,
    last_active_at: now,
  };

  insertConversation(db, conversation);
  return conversation;
}
