import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import {
  createWorktree,
  isWorktreeDirty,
  listWorktrees,
  parseWorktreeListPorcelain,
  removeWorktree,
  WorktreeError,
  worktreeExists,
} from "../server/worktrees/manager.ts";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "claude-remote-worktree-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function initRepo(path: string, initialBranch = "main") {
  mkdirSync(path, { recursive: true });
  await $`git -C ${path} init -b ${initialBranch}`.quiet();
  await $`git -C ${path} config user.email test@example.com`.quiet();
  await $`git -C ${path} config user.name Test`.quiet();
  writeFileSync(join(path, "README.md"), "test\n");
  await $`git -C ${path} add .`.quiet();
  await $`git -C ${path} commit -m initial`.quiet();
}

describe("parseWorktreeListPorcelain", () => {
  test("parses a single main worktree entry", () => {
    const text = "worktree /repo\nHEAD abc123\nbranch refs/heads/main\n";
    const entries = parseWorktreeListPorcelain(text);
    expect(entries).toEqual([
      { path: "/repo", branch: "main", head: "abc123", isBare: false, isDetached: false },
    ]);
  });

  test("parses multiple entries separated by blank lines", () => {
    const text =
      "worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\n" +
      "worktree /repo/.worktrees/feat\nHEAD def456\nbranch refs/heads/feat\n\n";
    const entries = parseWorktreeListPorcelain(text);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ path: "/repo/.worktrees/feat", branch: "feat" });
  });

  test("captures bare and detached flags", () => {
    const text = "worktree /bare\nbare\n\nworktree /detached\nHEAD abc\ndetached\n";
    const entries = parseWorktreeListPorcelain(text);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ path: "/bare", isBare: true, branch: null });
    expect(entries[1]).toMatchObject({ path: "/detached", isDetached: true, branch: null });
  });
});

describe("listWorktrees", () => {
  test("returns the main worktree on a fresh repo", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    const entries = await listWorktrees(repo);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ branch: "main", isBare: false, isDetached: false });
  });

  test("throws not_a_repo when the path is not a git repo", async () => {
    const plain = join(tempDir, "plain");
    mkdirSync(plain);
    let thrown: unknown;
    try {
      await listWorktrees(plain);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(WorktreeError);
    expect((thrown as WorktreeError).code).toBe("not_a_repo");
  });
});

describe("createWorktree (new-branch)", () => {
  test("creates a worktree on a new branch off the base branch", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    const target = join(tempDir, "wt", "feature-x");

    const entry = await createWorktree({
      repoPath: repo,
      worktreePath: target,
      branch: "feature/x",
      mode: "new-branch",
      baseBranch: "main",
    });

    expect(entry.branch).toBe("feature/x");
    expect(await worktreeExists(repo, target)).toBe(true);
  });

  test("throws missing_base_branch when base branch is missing or absent", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    const target = join(tempDir, "wt", "feat");

    await expect(
      createWorktree({
        repoPath: repo,
        worktreePath: target,
        branch: "feat",
        mode: "new-branch",
        baseBranch: "",
      }),
    ).rejects.toMatchObject({ code: "missing_base_branch" });

    await expect(
      createWorktree({
        repoPath: repo,
        worktreePath: target,
        branch: "feat",
        mode: "new-branch",
        baseBranch: "no-such-branch",
      }),
    ).rejects.toMatchObject({ code: "missing_base_branch" });
  });

  test("throws branch_already_exists when the new branch name is already taken", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    await $`git -C ${repo} branch existing`.quiet();

    await expect(
      createWorktree({
        repoPath: repo,
        worktreePath: join(tempDir, "wt", "existing"),
        branch: "existing",
        mode: "new-branch",
        baseBranch: "main",
      }),
    ).rejects.toMatchObject({ code: "branch_already_exists" });
  });
});

describe("createWorktree (existing-branch)", () => {
  test("creates a worktree that checks out an existing branch", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    await $`git -C ${repo} branch other`.quiet();
    const target = join(tempDir, "wt", "other");

    const entry = await createWorktree({
      repoPath: repo,
      worktreePath: target,
      branch: "other",
      mode: "existing-branch",
    });

    expect(entry.branch).toBe("other");
  });

  test("throws branch_already_checked_out when the branch is checked out elsewhere", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    await expect(
      createWorktree({
        repoPath: repo,
        worktreePath: join(tempDir, "wt", "main"),
        branch: "main",
        mode: "existing-branch",
      }),
    ).rejects.toMatchObject({ code: "branch_already_checked_out" });
  });

  test("throws git_error when the branch does not exist", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    await expect(
      createWorktree({
        repoPath: repo,
        worktreePath: join(tempDir, "wt", "nope"),
        branch: "no-such-branch",
        mode: "existing-branch",
      }),
    ).rejects.toBeInstanceOf(WorktreeError);
  });
});

describe("createWorktree (claims and path collisions)", () => {
  test("throws path_claimed when isClaimed returns true", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    await expect(
      createWorktree({
        repoPath: repo,
        worktreePath: join(tempDir, "wt", "feat"),
        branch: "feat",
        mode: "new-branch",
        baseBranch: "main",
        isClaimed: () => true,
      }),
    ).rejects.toMatchObject({ code: "path_claimed" });
  });

  test("throws path_exists when the target path already exists", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    const target = join(tempDir, "occupied");
    mkdirSync(target);
    await expect(
      createWorktree({
        repoPath: repo,
        worktreePath: target,
        branch: "feat",
        mode: "new-branch",
        baseBranch: "main",
      }),
    ).rejects.toMatchObject({ code: "path_exists" });
  });
});

describe("removeWorktree", () => {
  test("removes a clean worktree", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    const target = join(tempDir, "wt", "feat");
    await createWorktree({
      repoPath: repo,
      worktreePath: target,
      branch: "feat",
      mode: "new-branch",
      baseBranch: "main",
    });

    await removeWorktree(repo, target);
    expect(await worktreeExists(repo, target)).toBe(false);
  });

  test("refuses to remove a dirty worktree without force", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    const target = join(tempDir, "wt", "feat");
    await createWorktree({
      repoPath: repo,
      worktreePath: target,
      branch: "feat",
      mode: "new-branch",
      baseBranch: "main",
    });
    writeFileSync(join(target, "dirty.txt"), "hello\n");

    await expect(removeWorktree(repo, target)).rejects.toMatchObject({
      code: "dirty_worktree",
    });
    expect(await worktreeExists(repo, target)).toBe(true);
  });

  test("removes a dirty worktree when force is set", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    const target = join(tempDir, "wt", "feat");
    await createWorktree({
      repoPath: repo,
      worktreePath: target,
      branch: "feat",
      mode: "new-branch",
      baseBranch: "main",
    });
    writeFileSync(join(target, "dirty.txt"), "hello\n");

    await removeWorktree(repo, target, { force: true });
    expect(await worktreeExists(repo, target)).toBe(false);
  });

  test("throws not_a_worktree when the path is not a registered worktree", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    const stranger = join(tempDir, "stranger");
    mkdirSync(stranger);
    await expect(removeWorktree(repo, stranger)).rejects.toMatchObject({
      code: "not_a_worktree",
    });
  });
});

describe("isWorktreeDirty", () => {
  test("returns false for a clean worktree", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    expect(await isWorktreeDirty(repo)).toBe(false);
  });

  test("returns true after an untracked file is added", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    writeFileSync(join(repo, "new.txt"), "hi\n");
    expect(await isWorktreeDirty(repo)).toBe(true);
  });
});
