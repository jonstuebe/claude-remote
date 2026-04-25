import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import { runMigrationsFromDir } from "../server/db/migrator.ts";
import { registerProject } from "../server/projects/registry.ts";
import { ensureDefaultConversation } from "../server/conversations/registry.ts";
import { SessionManager } from "../server/sessions/manager.ts";
import type {
  SessionEvent,
  SpawnedSDKMessage,
  Spawner,
  SpawnOptions,
  SpawnResult,
} from "../server/sessions/types.ts";

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
  tempDir = mkdtempSync(join(tmpdir(), "claude-remote-sessions-"));
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

async function makeConversation(name: string) {
  const repo = join(tempDir, name);
  await initRepo(repo);
  const project = await registerProject(db, { name, repo_path: repo });
  return ensureDefaultConversation(db, project);
}

class FakeSpawn {
  pendingResults: Array<{
    resolve: (result: IteratorResult<SpawnedSDKMessage>) => void;
  }> = [];
  queued: SpawnedSDKMessage[] = [];
  closed = false;
  aborted = false;
  options: SpawnOptions;

  constructor(options: SpawnOptions) {
    this.options = options;
  }

  emit(message: SpawnedSDKMessage): void {
    if (this.closed) return;
    const next = this.pendingResults.shift();
    if (next) {
      next.resolve({ value: message, done: false });
    } else {
      this.queued.push(message);
    }
  }

  end(): void {
    this.closed = true;
    for (const p of this.pendingResults) {
      p.resolve({ value: undefined as unknown as SpawnedSDKMessage, done: true });
    }
    this.pendingResults.length = 0;
  }

  abort = (): void => {
    this.aborted = true;
    this.end();
  };

  iterator: AsyncIterable<SpawnedSDKMessage> = {
    [Symbol.asyncIterator]: (): AsyncIterator<SpawnedSDKMessage> => ({
      next: (): Promise<IteratorResult<SpawnedSDKMessage>> => {
        const buffered = this.queued.shift();
        if (buffered) return Promise.resolve({ value: buffered, done: false });
        if (this.closed) {
          return Promise.resolve({
            value: undefined as unknown as SpawnedSDKMessage,
            done: true,
          });
        }
        return new Promise((res) => this.pendingResults.push({ resolve: res }));
      },
    }),
  };

  toResult(): SpawnResult {
    return { iterator: this.iterator, abort: this.abort };
  }
}

class SpawnerTracker {
  spawns: FakeSpawn[] = [];
  spawner: Spawner;

  constructor() {
    this.spawner = (options: SpawnOptions): SpawnResult => {
      const fake = new FakeSpawn(options);
      this.spawns.push(fake);
      return fake.toResult();
    };
  }

  latest(): FakeSpawn {
    const last = this.spawns.at(-1);
    if (!last) throw new Error("no spawn yet");
    return last;
  }
}

function initMessage(sessionId: string): SpawnedSDKMessage {
  return {
    type: "system",
    subtype: "init",
    uuid: `init-${sessionId}`,
    session_id: sessionId,
  };
}

describe("SessionManager", () => {
  test("start spawns the SDK process and resolves with session info on init", async () => {
    const conversation = await makeConversation("alpha");
    const tracker = new SpawnerTracker();
    const manager = new SessionManager({
      db,
      spawner: tracker.spawner,
      isPidAlive: () => true,
      hostPid: 9999,
    });

    const promise = manager.start(conversation.id);
    await Promise.resolve();
    tracker.latest().emit(initMessage("sdk-1"));
    const info = await promise;

    expect(info.sdk_session_id).toBe("sdk-1");
    expect(info.host_pid).toBe(9999);
    expect(tracker.spawns).toHaveLength(1);

    const ledger = db
      .prepare<{ sdk_session_id: string; host_pid: number }, [string]>(
        "SELECT sdk_session_id, host_pid FROM session_ledger WHERE conversation_id = ?",
      )
      .get(conversation.id);
    expect(ledger?.sdk_session_id).toBe("sdk-1");
    expect(ledger?.host_pid).toBe(9999);
  });

  test("start is idempotent for an active session", async () => {
    const conversation = await makeConversation("idem");
    const tracker = new SpawnerTracker();
    const manager = new SessionManager({
      db,
      spawner: tracker.spawner,
      isPidAlive: () => true,
      hostPid: 1000,
    });

    const first = manager.start(conversation.id);
    tracker.latest().emit(initMessage("sdk-A"));
    await first;

    const second = await manager.start(conversation.id);
    expect(second.sdk_session_id).toBe("sdk-A");
    expect(tracker.spawns).toHaveLength(1);
  });

  test("concurrent start calls share a single spawn", async () => {
    const conversation = await makeConversation("concurrent");
    const tracker = new SpawnerTracker();
    const manager = new SessionManager({
      db,
      spawner: tracker.spawner,
      isPidAlive: () => true,
      hostPid: 1000,
    });

    const a = manager.start(conversation.id);
    const b = manager.start(conversation.id);
    await Promise.resolve();
    tracker.latest().emit(initMessage("sdk-conc"));
    const [resA, resB] = await Promise.all([a, b]);

    expect(resA.sdk_session_id).toBe("sdk-conc");
    expect(resB.sdk_session_id).toBe("sdk-conc");
    expect(tracker.spawns).toHaveLength(1);
  });

  test("stale ledger entries are pruned on start", async () => {
    const conversation = await makeConversation("stale");
    db.run(
      `INSERT INTO session_ledger
         (conversation_id, sdk_session_id, host_pid, started_at)
       VALUES (?, ?, ?, ?)`,
      [conversation.id, "old-session", 424242, new Date().toISOString()],
    );

    const tracker = new SpawnerTracker();
    const manager = new SessionManager({
      db,
      spawner: tracker.spawner,
      isPidAlive: (pid) => pid !== 424242,
      hostPid: 1000,
    });

    const promise = manager.start(conversation.id);
    await Promise.resolve();
    tracker.latest().emit(initMessage("sdk-fresh"));
    const info = await promise;

    expect(info.sdk_session_id).toBe("sdk-fresh");
    const ledger = db
      .prepare<{ sdk_session_id: string }, [string]>(
        "SELECT sdk_session_id FROM session_ledger WHERE conversation_id = ?",
      )
      .get(conversation.id);
    expect(ledger?.sdk_session_id).toBe("sdk-fresh");
  });

  test("worktree exclusivity blocks a second conversation on the same worktree", async () => {
    const a = await makeConversation("excl");
    const repoB = join(tempDir, "excl-b");
    await initRepo(repoB);
    const projectB = await registerProject(db, { name: "B", repo_path: repoB });
    const conversationB = await ensureDefaultConversation(db, projectB);

    db.run("UPDATE conversations SET worktree_path = ? WHERE id = ?", [
      a.worktree_path,
      conversationB.id,
    ]);

    const tracker = new SpawnerTracker();
    const manager = new SessionManager({
      db,
      spawner: tracker.spawner,
      isPidAlive: () => true,
      hostPid: 1000,
    });

    const first = manager.start(a.id);
    tracker.latest().emit(initMessage("sdk-A"));
    await first;

    await expect(manager.start(conversationB.id)).rejects.toMatchObject({
      name: "SessionStartError",
      code: "worktree_in_use",
    });
  });

  test("subscribe never spawns; events arrive once start completes", async () => {
    const conversation = await makeConversation("sub");
    const tracker = new SpawnerTracker();
    const manager = new SessionManager({
      db,
      spawner: tracker.spawner,
      isPidAlive: () => true,
      hostPid: 1000,
    });

    const events: SessionEvent[] = [];
    manager.subscribe(conversation.id, (e) => events.push(e));
    expect(tracker.spawns).toHaveLength(0);

    const promise = manager.start(conversation.id);
    tracker.latest().emit(initMessage("sdk-sub"));
    await promise;

    expect(events).toEqual([{ kind: "session_init", sdk_session_id: "sdk-sub" }]);
    expect(tracker.spawns).toHaveLength(1);
  });

  test("pruneStaleEntries removes ledger rows whose host_pid is dead", async () => {
    const a = await makeConversation("prune-a");
    const repoB = join(tempDir, "prune-b");
    await initRepo(repoB);
    const projectB = await registerProject(db, { name: "prune-b", repo_path: repoB });
    const conversationB = await ensureDefaultConversation(db, projectB);

    db.run(
      `INSERT INTO session_ledger
         (conversation_id, sdk_session_id, host_pid, started_at)
       VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
      [
        a.id,
        "sess-a",
        100,
        new Date().toISOString(),
        conversationB.id,
        "sess-b",
        200,
        new Date().toISOString(),
      ],
    );

    const tracker = new SpawnerTracker();
    const manager = new SessionManager({
      db,
      spawner: tracker.spawner,
      isPidAlive: (pid) => pid === 100,
      hostPid: 100,
    });

    expect(manager.pruneStaleEntries()).toBe(1);

    const remaining = db
      .prepare<{ conversation_id: string }, []>(
        "SELECT conversation_id FROM session_ledger ORDER BY conversation_id",
      )
      .all()
      .map((r) => r.conversation_id);
    expect(remaining).toEqual([a.id]);
  });

  test("send queues a user message; broadcasts assistant reply", async () => {
    const conversation = await makeConversation("send");
    const tracker = new SpawnerTracker();
    const manager = new SessionManager({
      db,
      spawner: tracker.spawner,
      isPidAlive: () => true,
      hostPid: 1000,
    });

    const events: SessionEvent[] = [];
    manager.subscribe(conversation.id, (e) => events.push(e));

    const promise = manager.start(conversation.id);
    tracker.latest().emit(initMessage("sdk-send"));
    await promise;

    await manager.send(conversation.id, "Hello there");

    const consumed: { type: string; content: unknown }[] = [];
    void (async () => {
      for await (const msg of tracker.latest().options.input) {
        consumed.push({ type: msg.type, content: msg.message.content });
      }
    })();
    await Promise.resolve();
    await Promise.resolve();
    expect(consumed[0]).toEqual({ type: "user", content: "Hello there" });

    tracker.latest().emit({
      type: "assistant",
      uuid: "asst-1",
      session_id: "sdk-send",
      message: { content: [{ type: "text", text: "Hi!" }] },
    });
    await Promise.resolve();
    await Promise.resolve();

    const assistant = events.find((e) => e.kind === "assistant_message");
    expect(assistant).toBeDefined();
    if (assistant?.kind === "assistant_message") {
      expect(assistant.blocks).toEqual([{ type: "text", text: "Hi!" }]);
    }
  });

  test("stop closes input, aborts spawn, deletes ledger row, emits session_end", async () => {
    const conversation = await makeConversation("stop");
    const tracker = new SpawnerTracker();
    const manager = new SessionManager({
      db,
      spawner: tracker.spawner,
      isPidAlive: () => true,
      hostPid: 1000,
    });

    const events: SessionEvent[] = [];
    manager.subscribe(conversation.id, (e) => events.push(e));

    const promise = manager.start(conversation.id);
    tracker.latest().emit(initMessage("sdk-stop"));
    await promise;

    await manager.stop(conversation.id);
    await Promise.resolve();

    expect(tracker.latest().aborted).toBe(true);
    expect(events.find((e) => e.kind === "session_end")).toBeDefined();

    const ledger = db
      .prepare<{ conversation_id: string }, [string]>(
        "SELECT conversation_id FROM session_ledger WHERE conversation_id = ?",
      )
      .get(conversation.id);
    expect(ledger).toBeNull();
  });
});
