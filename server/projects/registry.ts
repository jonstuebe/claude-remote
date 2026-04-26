import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import { assertGitRepo, detectDefaultBranch, NotAGitRepoError } from "../git.ts";

export type PermissionsMode = "bypassPermissions" | "acceptEdits";

export type Project = {
  id: string;
  name: string;
  repo_path: string;
  default_branch: string;
  worktree_root: string;
  permissions_mode: PermissionsMode;
  created_at: string;
};

export type RegisterProjectInput = {
  name: string;
  repo_path: string;
};

export type UpdateProjectInput = {
  permissions_mode?: PermissionsMode;
};

export class ProjectValidationError extends Error {
  readonly field: "name" | "repo_path";
  readonly code: string;
  constructor(field: "name" | "repo_path", code: string, message: string) {
    super(message);
    this.name = "ProjectValidationError";
    this.field = field;
    this.code = code;
  }
}

export class ProjectNotFoundError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`No project with id "${id}"`);
    this.name = "ProjectNotFoundError";
    this.id = id;
  }
}

const PROJECT_COLUMNS =
  "id, name, repo_path, default_branch, worktree_root, permissions_mode, created_at";

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    repo_path: row.repo_path as string,
    default_branch: row.default_branch as string,
    worktree_root: row.worktree_root as string,
    permissions_mode: row.permissions_mode as PermissionsMode,
    created_at: row.created_at as string,
  };
}

function defaultWorktreeRoot(repoPath: string): string {
  const parent = dirname(repoPath);
  const name = basename(repoPath);
  return resolve(parent, ".worktrees", name);
}

export async function registerProject(db: Database, input: RegisterProjectInput): Promise<Project> {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new ProjectValidationError("name", "required", "Name is required");
  }
  if (name.length > 100) {
    throw new ProjectValidationError("name", "too_long", "Name must be 100 characters or fewer");
  }

  const rawPath = (input.repo_path ?? "").trim();
  if (rawPath.length === 0) {
    throw new ProjectValidationError("repo_path", "required", "Repo path is required");
  }

  let absolutePath: string;
  try {
    absolutePath = await assertGitRepo(rawPath);
  } catch (err) {
    if (err instanceof NotAGitRepoError) {
      throw new ProjectValidationError("repo_path", "not_a_git_repo", err.message);
    }
    throw err;
  }

  const existing = db
    .prepare<{ id: string }, [string]>("SELECT id FROM projects WHERE repo_path = ?")
    .get(absolutePath);
  if (existing) {
    throw new ProjectValidationError(
      "repo_path",
      "already_registered",
      `A project is already registered at "${absolutePath}"`,
    );
  }

  const defaultBranch = await detectDefaultBranch(absolutePath);
  const worktreeRoot = defaultWorktreeRoot(absolutePath);

  const project: Project = {
    id: randomUUID(),
    name,
    repo_path: absolutePath,
    default_branch: defaultBranch,
    worktree_root: worktreeRoot,
    permissions_mode: "bypassPermissions",
    created_at: new Date().toISOString(),
  };

  db.run(`INSERT INTO projects (${PROJECT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    project.id,
    project.name,
    project.repo_path,
    project.default_branch,
    project.worktree_root,
    project.permissions_mode,
    project.created_at,
  ]);

  return project;
}

export function listProjects(db: Database): Project[] {
  const rows = db
    .prepare<Record<string, unknown>, []>(
      `SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY created_at ASC`,
    )
    .all();
  return rows.map(rowToProject);
}

export function getProject(db: Database, id: string): Project | null {
  const row = db
    .prepare<Record<string, unknown>, [string]>(
      `SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`,
    )
    .get(id);
  return row ? rowToProject(row) : null;
}

export function updateProject(db: Database, id: string, input: UpdateProjectInput): Project {
  const current = getProject(db, id);
  if (!current) throw new ProjectNotFoundError(id);

  if (input.permissions_mode !== undefined) {
    db.run("UPDATE projects SET permissions_mode = ? WHERE id = ?", [input.permissions_mode, id]);
  }

  const updated = getProject(db, id);
  if (!updated) throw new ProjectNotFoundError(id);
  return updated;
}

export function deleteProject(db: Database, id: string): boolean {
  const result = db.run("DELETE FROM projects WHERE id = ?", [id]);
  return result.changes > 0;
}
