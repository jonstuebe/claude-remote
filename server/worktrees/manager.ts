import { resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { $ } from "bun";

export type WorktreeErrorCode =
  | "not_a_repo"
  | "not_a_worktree"
  | "path_claimed"
  | "path_exists"
  | "branch_already_checked_out"
  | "branch_already_exists"
  | "missing_base_branch"
  | "dirty_worktree"
  | "git_error";

export class WorktreeError extends Error {
  readonly code: WorktreeErrorCode;
  constructor(code: WorktreeErrorCode, message: string) {
    super(message);
    this.name = "WorktreeError";
    this.code = code;
  }
}

export type WorktreeEntry = {
  path: string;
  branch: string | null;
  head: string | null;
  isBare: boolean;
  isDetached: boolean;
};

export type CreateMode = "new-branch" | "existing-branch";

export type CreateWorktreeOptions = {
  repoPath: string;
  worktreePath: string;
  branch: string;
  mode: CreateMode;
  baseBranch?: string;
  isClaimed?: (path: string) => boolean;
};

export type RemoveWorktreeOptions = {
  force?: boolean;
};

async function pathExists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null;
}

async function canonicalize(path: string): Promise<string> {
  const absolute = resolve(path);
  return (await realpath(absolute).catch(() => null)) ?? absolute;
}

export function parseWorktreeListPorcelain(text: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> | null = null;

  const finalize = () => {
    if (current?.path) {
      entries.push({
        path: current.path,
        branch: current.branch ?? null,
        head: current.head ?? null,
        isBare: current.isBare ?? false,
        isDetached: current.isDetached ?? false,
      });
    }
    current = null;
  };

  for (const line of text.split("\n")) {
    if (line.length === 0) {
      finalize();
      continue;
    }
    if (!current) current = {};
    const space = line.indexOf(" ");
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? "" : line.slice(space + 1);
    if (key === "worktree") current.path = value;
    else if (key === "HEAD") current.head = value;
    else if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
    else if (key === "bare") current.isBare = true;
    else if (key === "detached") current.isDetached = true;
  }
  finalize();
  return entries;
}

export async function listWorktrees(repoPath: string): Promise<WorktreeEntry[]> {
  const result = await $`git -C ${repoPath} worktree list --porcelain`.quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new WorktreeError("not_a_repo", `Not a git repository: ${repoPath}`);
  }
  return parseWorktreeListPorcelain(result.stdout.toString());
}

export async function worktreeExists(repoPath: string, worktreePath: string): Promise<boolean> {
  const target = await canonicalize(worktreePath);
  const list = await listWorktrees(repoPath);
  for (const entry of list) {
    if ((await canonicalize(entry.path)) === target) return true;
  }
  return false;
}

export async function isWorktreeDirty(worktreePath: string): Promise<boolean> {
  const result = await $`git -C ${worktreePath} status --porcelain`.quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new WorktreeError("not_a_repo", `Not a git working tree: ${worktreePath}`);
  }
  return result.stdout.toString().trim().length > 0;
}

async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  const ref = `refs/heads/${branch}`;
  const result = await $`git -C ${repoPath} show-ref --verify --quiet ${ref}`.quiet().nothrow();
  return result.exitCode === 0;
}

export async function createWorktree(opts: CreateWorktreeOptions): Promise<WorktreeEntry> {
  const target = resolve(opts.worktreePath);

  if (opts.isClaimed?.(target)) {
    throw new WorktreeError("path_claimed", `Worktree path is already claimed: ${target}`);
  }

  if (await pathExists(target)) {
    throw new WorktreeError("path_exists", `A file or directory already exists at ${target}`);
  }

  if (opts.mode === "new-branch") {
    const base = opts.baseBranch?.trim() ?? "";
    if (base.length === 0) {
      throw new WorktreeError("missing_base_branch", "Base branch is required for new-branch mode");
    }
    if (!(await branchExists(opts.repoPath, base))) {
      throw new WorktreeError("missing_base_branch", `Base branch "${base}" does not exist`);
    }
    if (await branchExists(opts.repoPath, opts.branch)) {
      throw new WorktreeError(
        "branch_already_exists",
        `Branch "${opts.branch}" already exists; use existing-branch mode to attach`,
      );
    }
    const result = await $`git -C ${opts.repoPath} worktree add -b ${opts.branch} ${target} ${base}`
      .quiet()
      .nothrow();
    if (result.exitCode !== 0) {
      throw new WorktreeError(
        "git_error",
        result.stderr.toString().trim() || "git worktree add failed",
      );
    }
  } else {
    if (!(await branchExists(opts.repoPath, opts.branch))) {
      throw new WorktreeError("git_error", `Branch "${opts.branch}" does not exist`);
    }
    const result = await $`git -C ${opts.repoPath} worktree add ${target} ${opts.branch}`
      .quiet()
      .nothrow();
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString();
      if (/is already checked out|is already used/i.test(stderr)) {
        throw new WorktreeError(
          "branch_already_checked_out",
          `Branch "${opts.branch}" is already checked out elsewhere`,
        );
      }
      throw new WorktreeError("git_error", stderr.trim() || "git worktree add failed");
    }
  }

  const canonicalTarget = await canonicalize(target);
  const entries = await listWorktrees(opts.repoPath);
  let created: WorktreeEntry | null = null;
  for (const entry of entries) {
    if ((await canonicalize(entry.path)) === canonicalTarget) {
      created = entry;
      break;
    }
  }
  if (!created) {
    throw new WorktreeError(
      "git_error",
      "Worktree did not appear in git worktree list after creation",
    );
  }
  return created;
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  opts: RemoveWorktreeOptions = {},
): Promise<void> {
  const target = resolve(worktreePath);
  if (!(await worktreeExists(repoPath, target))) {
    throw new WorktreeError("not_a_worktree", `Not a registered worktree: ${target}`);
  }
  if (!opts.force) {
    if (await isWorktreeDirty(target)) {
      throw new WorktreeError("dirty_worktree", `Worktree has uncommitted changes: ${target}`);
    }
  }
  const result = opts.force
    ? await $`git -C ${repoPath} worktree remove --force ${target}`.quiet().nothrow()
    : await $`git -C ${repoPath} worktree remove ${target}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new WorktreeError(
      "git_error",
      result.stderr.toString().trim() || "git worktree remove failed",
    );
  }
}
