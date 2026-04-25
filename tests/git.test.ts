import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { assertGitRepo, detectDefaultBranch, NotAGitRepoError } from "../server/git.ts";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "claude-remote-git-"));
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

describe("assertGitRepo", () => {
  test("returns the canonical path for a valid repo root", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    const result = await assertGitRepo(repo);
    expect(result).toBe(realpathSync(repo));
  });

  test("throws when the path is not a directory", async () => {
    const missing = join(tempDir, "does-not-exist");
    await expect(assertGitRepo(missing)).rejects.toBeInstanceOf(NotAGitRepoError);
  });

  test("throws when the directory is not a git repo", async () => {
    const plain = join(tempDir, "not-a-repo");
    mkdirSync(plain);
    await expect(assertGitRepo(plain)).rejects.toBeInstanceOf(NotAGitRepoError);
  });

  test("throws when the path is inside a repo but not its root", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    const sub = join(repo, "sub");
    mkdirSync(sub);
    await expect(assertGitRepo(sub)).rejects.toThrow(/not its root/);
  });
});

describe("detectDefaultBranch", () => {
  test("returns the local branch name when there is no origin", async () => {
    const repo = join(tempDir, "repo-trunk");
    await initRepo(repo, "trunk");
    const branch = await detectDefaultBranch(repo);
    expect(branch).toBe("trunk");
  });

  test("uses origin/HEAD when present", async () => {
    const upstream = join(tempDir, "upstream.git");
    mkdirSync(upstream);
    await $`git -C ${upstream} init --bare -b main`.quiet();

    const repo = join(tempDir, "clone");
    await initRepo(repo, "main");
    await $`git -C ${repo} remote add origin ${upstream}`.quiet();
    await $`git -C ${repo} push -u origin main`.quiet();

    // Make a local-only branch and switch to it; origin's HEAD should still
    // be detected as `main`.
    await $`git -C ${repo} checkout -b feature/local`.quiet();
    await $`git -C ${repo} remote set-head origin main`.quiet();

    const branch = await detectDefaultBranch(repo);
    expect(branch).toBe("main");
  });
});
