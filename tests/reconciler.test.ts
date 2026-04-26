import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import { runMigrationsFromDir } from "../server/db/migrator.ts";
import { registerProject } from "../server/projects/registry.ts";
import { createConversation, getConversation } from "../server/conversations/registry.ts";
import { reconcileProject } from "../server/reconciler.ts";
import { sanitizeProjectKey } from "../server/transcript/reader.ts";

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
  "db",
  "migrations",
);

let tempDir: string;
let db: Database;
let previousHome: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "claude-remote-reconciler-"));
  previousHome = process.env.HOME;
  process.env.HOME = join(tempDir, "home");
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrationsFromDir(db, MIGRATIONS_DIR);
});

afterEach(() => {
  db.close();
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
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

function writeTranscript(cwd: string, sessionId: string) {
  const dir = join(process.env.HOME!, ".claude", "projects", sanitizeProjectKey(cwd));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sessionId}.jsonl`),
    JSON.stringify({
      type: "user",
      uuid: "u1",
      timestamp: "2026-01-01T00:00:00.000Z",
      message: { role: "user", content: "hello" },
    }) + "\n",
  );
}

describe("Reconciler", () => {
  test("lazily creates the default conversation on project open", async () => {
    const repo = join(tempDir, "repo");
    await initRepo(repo);
    const project = await registerProject(db, { name: "Repo", repo_path: repo });

    const result = await reconcileProject(db, project);

    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]).toMatchObject({
      project_id: project.id,
      worktree_path: project.repo_path,
      is_default: true,
      status: "active",
    });
  });

  test("is idempotent on a clean state", async () => {
    const repo = join(tempDir, "clean");
    await initRepo(repo);
    const project = await registerProject(db, { name: "Clean", repo_path: repo });

    const first = await reconcileProject(db, project);
    const second = await reconcileProject(db, project);

    expect(second.conversations.map((conversation) => conversation.id)).toEqual(
      first.conversations.map((conversation) => conversation.id),
    );
    expect(second.importable_worktrees).toEqual([]);
  });

  test("marks a conversation orphaned when its worktree disappears", async () => {
    const repo = join(tempDir, "orphan");
    await initRepo(repo);
    const project = await registerProject(db, { name: "Orphan", repo_path: repo });
    const conversation = await createConversation(db, project, {
      mode: "new-worktree",
      branch: "feature/orphan",
    });
    await $`git -C ${repo} worktree remove --force ${conversation.worktree_path}`.quiet();

    await reconcileProject(db, project);

    expect(getConversation(db, conversation.id)?.status).toBe("orphaned");
  });

  test("surfaces externally created worktrees with their latest transcript session", async () => {
    const repo = join(tempDir, "external");
    await initRepo(repo);
    const project = await registerProject(db, { name: "External", repo_path: repo });
    await $`git -C ${repo} branch terminal-work`.quiet();
    const rawWorktreePath = join(tempDir, "external-worktree");
    await $`git -C ${repo} worktree add ${rawWorktreePath} terminal-work`.quiet();
    const worktreePath = realpathSync(rawWorktreePath);
    writeTranscript(worktreePath, "session-terminal");

    const result = await reconcileProject(db, project);

    expect(result.importable_worktrees).toEqual([
      {
        path: worktreePath,
        branch: "terminal-work",
        session_id: "session-terminal",
      },
    ]);
  });
});
