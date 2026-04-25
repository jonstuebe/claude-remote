import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import { runMigrationsFromDir } from "../server/db/migrator.ts";
import {
  deleteProject,
  getProject,
  listProjects,
  ProjectValidationError,
  registerProject,
} from "../server/projects/registry.ts";

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
  "db",
  "migrations",
);

let tempDir: string;
let db: Database;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "claude-remote-registry-"));
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrationsFromDir(db, MIGRATIONS_DIR);
});

afterEach(() => {
  db.close();
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

describe("Project Registry", () => {
  test("registers a project at a valid git repo with the detected default branch", async () => {
    const repo = join(tempDir, "alpha");
    await initRepo(repo, "main");

    const project = await registerProject(db, { name: "Alpha", repo_path: repo });
    const canonicalRepo = realpathSync(repo);
    const canonicalParent = realpathSync(tempDir);

    expect(project.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(project.name).toBe("Alpha");
    expect(project.repo_path).toBe(canonicalRepo);
    expect(project.default_branch).toBe("main");
    expect(project.permissions_mode).toBe("bypassPermissions");
    expect(project.worktree_root).toBe(resolve(canonicalParent, ".worktrees", "alpha"));
    expect(project.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("trims the project name and rejects empty values", async () => {
    const repo = join(tempDir, "named");
    await initRepo(repo);

    await expect(registerProject(db, { name: "   ", repo_path: repo })).rejects.toBeInstanceOf(
      ProjectValidationError,
    );
  });

  test("rejects a path that is not a git repo with a clear validation error", async () => {
    const plain = join(tempDir, "plain");
    mkdirSync(plain);

    let thrown: unknown;
    try {
      await registerProject(db, { name: "Plain", repo_path: plain });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ProjectValidationError);
    const err = thrown as ProjectValidationError;
    expect(err.field).toBe("repo_path");
    expect(err.code).toBe("not_a_git_repo");
  });

  test("rejects a missing path with a not_a_git_repo error", async () => {
    const missing = join(tempDir, "ghost");
    await expect(registerProject(db, { name: "Ghost", repo_path: missing })).rejects.toMatchObject({
      field: "repo_path",
      code: "not_a_git_repo",
    });
  });

  test("rejects re-registering the same path", async () => {
    const repo = join(tempDir, "twice");
    await initRepo(repo);

    await registerProject(db, { name: "Twice", repo_path: repo });

    await expect(
      registerProject(db, { name: "Twice Again", repo_path: repo }),
    ).rejects.toMatchObject({ code: "already_registered" });
  });

  test("listProjects returns projects in insertion order", async () => {
    const a = join(tempDir, "a");
    const b = join(tempDir, "b");
    await initRepo(a);
    await initRepo(b);

    await registerProject(db, { name: "A", repo_path: a });
    // Tiny delay so created_at differs across rows on systems with coarse clocks.
    await new Promise((r) => setTimeout(r, 5));
    await registerProject(db, { name: "B", repo_path: b });

    const all = listProjects(db);
    expect(all.map((p) => p.name)).toEqual(["A", "B"]);
  });

  test("getProject returns the project by id, or null if missing", async () => {
    const repo = join(tempDir, "single");
    await initRepo(repo);
    const created = await registerProject(db, { name: "Single", repo_path: repo });

    expect(getProject(db, created.id)?.id).toBe(created.id);
    expect(getProject(db, "nonexistent-id")).toBeNull();
  });

  test("deleteProject removes the row and returns true; false when missing", async () => {
    const repo = join(tempDir, "doomed");
    await initRepo(repo);
    const created = await registerProject(db, { name: "Doomed", repo_path: repo });

    expect(deleteProject(db, created.id)).toBe(true);
    expect(getProject(db, created.id)).toBeNull();
    expect(deleteProject(db, created.id)).toBe(false);
  });
});
