import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import { runMigrationsFromDir } from "../server/db/migrator.ts";
import { registerProject } from "../server/projects/registry.ts";
import {
  ConversationValidationError,
  createConversation,
  deleteConversation,
  ensureDefaultConversation,
  getConversation,
  listConversations,
  updateConversation,
} from "../server/conversations/registry.ts";
import { worktreeExists } from "../server/worktrees/manager.ts";

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
  tempDir = mkdtempSync(join(tmpdir(), "claude-remote-conversations-"));
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

async function makeProject(name: string, branch = "main") {
  const repo = join(tempDir, name);
  await initRepo(repo, branch);
  return registerProject(db, { name, repo_path: repo });
}

describe("Conversations Registry", () => {
  test("ensureDefaultConversation creates the default conversation on first call", async () => {
    const project = await makeProject("Alpha");

    const conversation = await ensureDefaultConversation(db, project);

    expect(conversation.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(conversation.project_id).toBe(project.id);
    expect(conversation.worktree_path).toBe(project.repo_path);
    expect(conversation.branch).toBe("main");
    expect(conversation.title).toBe("Alpha");
    expect(conversation.is_default).toBe(true);
    expect(conversation.status).toBe("active");
    expect(conversation.session_id).toBeNull();
    expect(conversation.color).toBeNull();
    expect(conversation.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(conversation.last_active_at).toBe(conversation.created_at);
  });

  test("ensureDefaultConversation is idempotent", async () => {
    const project = await makeProject("Beta");

    const first = await ensureDefaultConversation(db, project);
    const second = await ensureDefaultConversation(db, project);

    expect(second.id).toBe(first.id);
    expect(listConversations(db, project.id)).toHaveLength(1);
  });

  test("ensureDefaultConversation captures the repo's current branch, not the default branch", async () => {
    const project = await makeProject("Gamma", "main");
    await $`git -C ${project.repo_path} checkout -b feature/x`.quiet();

    const conversation = await ensureDefaultConversation(db, project);
    expect(conversation.branch).toBe("feature/x");
  });

  test("listConversations returns the default first, then others by last_active_at desc", async () => {
    const project = await makeProject("Delta");
    await ensureDefaultConversation(db, project);

    const baseTime = Date.parse("2026-01-01T00:00:00.000Z");
    const insertExtra = (suffix: string, lastActiveAt: string) => {
      db.run(
        `INSERT INTO conversations
         (id, project_id, worktree_path, branch, session_id, title, color, is_default, status, created_at, last_active_at)
         VALUES (?, ?, ?, ?, NULL, ?, NULL, 0, 'active', ?, ?)`,
        [
          `extra-${suffix}`,
          project.id,
          `${project.worktree_root}/${suffix}`,
          `feat/${suffix}`,
          `Extra ${suffix}`,
          new Date(baseTime).toISOString(),
          lastActiveAt,
        ],
      );
    };

    insertExtra("old", new Date(baseTime + 1_000).toISOString());
    insertExtra("new", new Date(baseTime + 5_000).toISOString());
    insertExtra("mid", new Date(baseTime + 3_000).toISOString());

    const list = listConversations(db, project.id);
    expect(list).toHaveLength(4);
    expect(list[0]!.is_default).toBe(true);
    expect(list.slice(1).map((c) => c.id)).toEqual(["extra-new", "extra-mid", "extra-old"]);
  });

  test("listConversations returns an empty array for a project with no rows", async () => {
    const project = await makeProject("Empty");
    expect(listConversations(db, project.id)).toEqual([]);
  });

  test("getConversation returns the conversation by id, or null if missing", async () => {
    const project = await makeProject("Lookup");
    const created = await ensureDefaultConversation(db, project);

    expect(getConversation(db, created.id)?.id).toBe(created.id);
    expect(getConversation(db, "nope")).toBeNull();
  });

  test("updateConversation persists title, color, and archive status", async () => {
    const project = await makeProject("Update");
    const created = await ensureDefaultConversation(db, project);

    const updated = updateConversation(db, created.id, {
      title: "New title",
      color: "purple",
      archived: true,
    });

    expect(updated.title).toBe("New title");
    expect(updated.color).toBe("purple");
    expect(updated.status).toBe("archived");
    expect(getConversation(db, created.id)).toMatchObject({
      title: "New title",
      color: "purple",
      status: "archived",
    });
  });

  test("updateConversation rejects empty titles and unknown colors", async () => {
    const project = await makeProject("ValidateUpdate");
    const created = await ensureDefaultConversation(db, project);

    expect(() => updateConversation(db, created.id, { title: "   " })).toThrow(
      ConversationValidationError,
    );
    expect(() => updateConversation(db, created.id, { color: "chartreuse" as never })).toThrow(
      ConversationValidationError,
    );
  });

  test("deleteConversation removes only the row when worktree removal is not requested", async () => {
    const project = await makeProject("DeleteRow");
    const conversation = await createConversation(db, project, {
      mode: "new-worktree",
      branch: "feature/delete-row",
    });

    await deleteConversation(db, project, conversation, { removeWorktree: false });

    expect(getConversation(db, conversation.id)).toBeNull();
    expect(await worktreeExists(project.repo_path, conversation.worktree_path)).toBe(true);
  });

  test("deleteConversation can remove the owned worktree and warns on dirty worktrees", async () => {
    const project = await makeProject("DeleteWorktree");
    const conversation = await createConversation(db, project, {
      mode: "new-worktree",
      branch: "feature/delete-worktree",
    });
    writeFileSync(join(conversation.worktree_path, "dirty.txt"), "dirty\n");

    await expect(
      deleteConversation(db, project, conversation, { removeWorktree: true }),
    ).rejects.toMatchObject({ code: "dirty_worktree" });
    expect(getConversation(db, conversation.id)?.id).toBe(conversation.id);

    await deleteConversation(db, project, conversation, { removeWorktree: true, force: true });

    expect(getConversation(db, conversation.id)).toBeNull();
    expect(await worktreeExists(project.repo_path, conversation.worktree_path)).toBe(false);
  });
});

describe("createConversation", () => {
  test("new-worktree mode creates a worktree and a conversation row off the default branch", async () => {
    const project = await makeProject("WT");
    await ensureDefaultConversation(db, project);

    const conversation = await createConversation(db, project, {
      mode: "new-worktree",
      branch: "feature/x",
    });

    expect(conversation.is_default).toBe(false);
    expect(conversation.branch).toBe("feature/x");
    expect(conversation.title).toBe("feature/x");
    expect(conversation.worktree_path).toBe(`${project.worktree_root}/feature/x`);

    const stored = getConversation(db, conversation.id);
    expect(stored?.id).toBe(conversation.id);
  });

  test("new-worktree mode honors an explicit base_branch", async () => {
    const project = await makeProject("Base");
    await $`git -C ${project.repo_path} checkout -b release`.quiet();
    await $`git -C ${project.repo_path} checkout main`.quiet();

    const conversation = await createConversation(db, project, {
      mode: "new-worktree",
      branch: "fix/bug",
      base_branch: "release",
    });

    expect(conversation.branch).toBe("fix/bug");
  });

  test("existing-branch mode attaches a worktree to a branch that already exists", async () => {
    const project = await makeProject("Existing");
    await $`git -C ${project.repo_path} branch other`.quiet();

    const conversation = await createConversation(db, project, {
      mode: "existing-branch",
      branch: "other",
    });

    expect(conversation.branch).toBe("other");
    expect(conversation.worktree_path).toBe(`${project.worktree_root}/other`);
  });

  test("existing-branch mode rejects a branch that does not exist", async () => {
    const project = await makeProject("Missing");
    let thrown: unknown;
    try {
      await createConversation(db, project, {
        mode: "existing-branch",
        branch: "ghost",
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ConversationValidationError);
    expect((thrown as ConversationValidationError).code).toBe("worktree_create_failed");
  });

  test("rejects creating a second conversation that would claim the same worktree path", async () => {
    const project = await makeProject("Dup");
    await createConversation(db, project, { mode: "new-worktree", branch: "feat" });

    await expect(
      createConversation(db, project, { mode: "new-worktree", branch: "feat" }),
    ).rejects.toMatchObject({ code: "worktree_in_use" });
  });

  test("requires a branch for new-worktree and existing-branch modes", async () => {
    const project = await makeProject("NoBranch");
    await expect(
      createConversation(db, project, { mode: "new-worktree", branch: "" }),
    ).rejects.toMatchObject({ code: "branch_required", field: "branch" });
    await expect(
      createConversation(db, project, { mode: "existing-branch", branch: "   " }),
    ).rejects.toMatchObject({ code: "branch_required", field: "branch" });
  });

  test("main mode reuses the project repo path and rejects when already claimed", async () => {
    const project = await makeProject("MainMode");
    await ensureDefaultConversation(db, project);

    await expect(createConversation(db, project, { mode: "main" })).rejects.toMatchObject({
      code: "worktree_in_use",
    });
  });

  test("main mode succeeds when no default conversation has been seeded", async () => {
    const project = await makeProject("MainSolo");
    const conversation = await createConversation(db, project, { mode: "main" });
    expect(conversation.worktree_path).toBe(project.repo_path);
    expect(conversation.is_default).toBe(false);
  });

  test("missing base_branch surfaces a clear validation error", async () => {
    const project = await makeProject("BadBase");
    await expect(
      createConversation(db, project, {
        mode: "new-worktree",
        branch: "feat",
        base_branch: "no-such-branch",
      }),
    ).rejects.toMatchObject({ code: "worktree_create_failed", field: "base_branch" });
  });
});
