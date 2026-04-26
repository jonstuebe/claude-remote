import type { Database } from "bun:sqlite";
import type { AssistantBlock } from "../transcript/reader.ts";
import { InputStream } from "./input-stream.ts";
import type {
  Listener,
  SessionEvent,
  SpawnedSDKMessage,
  Spawner,
  SpawnInputMessage,
} from "./types.ts";
import type { PermissionBroker, PermissionDecision } from "../permissions/broker.ts";
import { slashCommandRegistry } from "../slash-commands/registry.ts";
import { listTranscriptSessions } from "../transcript/reader.ts";

export class SessionStartError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SessionStartError";
    this.code = code;
  }
}

export type SessionManagerOptions = {
  db: Database;
  spawner: Spawner;
  permissions?: PermissionBroker;
  isPidAlive?: (pid: number) => boolean;
  hostPid?: number;
};

export type SessionInfo = {
  conversation_id: string;
  sdk_session_id: string;
  host_pid: number;
};

type ActiveSession = {
  conversation_id: string;
  worktree_path: string;
  sdk_session_id: string;
  host_pid: number;
  input: InputStream;
  abort: () => void;
};

type ConversationRow = {
  id: string;
  worktree_path: string;
  session_id: string | null;
  permissions_mode: "bypassPermissions" | "acceptEdits";
};

const TAKEOVER_WINDOW_MS = 5 * 60 * 1000;

const defaultIsPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export class SessionManager {
  private readonly db: Database;
  private readonly spawner: Spawner;
  private readonly permissions: PermissionBroker | null;
  private readonly isPidAlive: (pid: number) => boolean;
  private readonly hostPid: number;

  private readonly active = new Map<string, ActiveSession>();
  private readonly inflight = new Map<string, Promise<SessionInfo>>();
  private readonly subscribers = new Map<string, Set<Listener>>();
  private readonly buffered = new Map<string, SessionEvent[]>();

  constructor(options: SessionManagerOptions) {
    this.db = options.db;
    this.spawner = options.spawner;
    this.permissions = options.permissions ?? null;
    this.isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
    this.hostPid = options.hostPid ?? process.pid;
  }

  pruneStaleEntries(): number {
    const rows = this.db
      .prepare<{ conversation_id: string; host_pid: number }, []>(
        "SELECT conversation_id, host_pid FROM session_ledger",
      )
      .all();
    let pruned = 0;
    for (const row of rows) {
      if (!this.isPidAlive(row.host_pid)) {
        this.db.run("DELETE FROM session_ledger WHERE conversation_id = ?", [row.conversation_id]);
        pruned += 1;
      }
    }
    return pruned;
  }

  hasActiveSession(conversationId: string): boolean {
    return this.active.has(conversationId);
  }

  subscribe(conversationId: string, listener: Listener): () => void {
    let group = this.subscribers.get(conversationId);
    if (!group) {
      group = new Set();
      this.subscribers.set(conversationId, group);
    }
    group.add(listener);
    return () => {
      const g = this.subscribers.get(conversationId);
      if (!g) return;
      g.delete(listener);
      if (g.size === 0) this.subscribers.delete(conversationId);
    };
  }

  bufferedEvents(conversationId: string): SessionEvent[] {
    return [...(this.buffered.get(conversationId) ?? [])];
  }

  emit(conversationId: string, event: SessionEvent): void {
    this.broadcast(conversationId, event);
  }

  async start(
    conversationId: string,
    options: { firstInput?: SpawnInputMessage } = {},
  ): Promise<SessionInfo> {
    const inflight = this.inflight.get(conversationId);
    if (inflight) return inflight;

    const existing = this.active.get(conversationId);
    if (existing && this.isPidAlive(existing.host_pid)) {
      return {
        conversation_id: existing.conversation_id,
        sdk_session_id: existing.sdk_session_id,
        host_pid: existing.host_pid,
      };
    }

    const ledgerRow = this.db
      .prepare<{ conversation_id: string; sdk_session_id: string; host_pid: number }, [string]>(
        "SELECT conversation_id, sdk_session_id, host_pid FROM session_ledger WHERE conversation_id = ?",
      )
      .get(conversationId);
    if (ledgerRow && !this.isPidAlive(ledgerRow.host_pid)) {
      this.db.run("DELETE FROM session_ledger WHERE conversation_id = ?", [conversationId]);
    } else if (ledgerRow && !existing) {
      this.db.run("DELETE FROM session_ledger WHERE conversation_id = ?", [conversationId]);
    }

    const promise = this.doSpawn(conversationId, options.firstInput);
    this.inflight.set(conversationId, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(conversationId);
    }
  }

  async send(conversationId: string, text: string, options: { takeover?: boolean } = {}): Promise<void> {
    const message: SpawnInputMessage = {
      type: "user",
      message: { role: "user", content: text },
    };

    const active = this.active.get(conversationId);
    if (active && this.isPidAlive(active.host_pid)) {
      active.input.push(message);
      return;
    }

    // Concurrent send raced ahead of us — wait for that spawn, then push.
    const inflight = this.inflight.get(conversationId);
    if (inflight) {
      await inflight;
      const ready = this.active.get(conversationId);
      if (!ready) throw new SessionStartError("not_started", "Session is not running");
      ready.input.push(message);
      return;
    }

    // First send for this conversation. Pre-buffer the user's text so the SDK
    // has input on its first read — without it, the SDK never emits the init
    // message we await on start, and we deadlock.
    if (
      !options.takeover &&
      this.hasRecordedSession(conversationId) &&
      (await this.needsTakeover(conversationId))
    ) {
      throw new SessionStartError(
        "takeover_required",
        "This conversation may be active in your terminal. Take over?",
      );
    }
    await this.start(conversationId, { firstInput: message });
  }

  async stop(conversationId: string): Promise<void> {
    const session = this.active.get(conversationId);
    if (!session) return;
    session.input.close();
    session.abort();
    this.cleanup(conversationId, "stopped");
  }

  async release(conversationId: string): Promise<void> {
    await this.stop(conversationId);
    this.db.run("DELETE FROM session_ledger WHERE conversation_id = ?", [conversationId]);
  }

  resolvePermission(requestId: string, decision: PermissionDecision): boolean {
    return this.permissions?.resolve(requestId, decision) ?? false;
  }

  private async doSpawn(
    conversationId: string,
    firstInput?: SpawnInputMessage,
  ): Promise<SessionInfo> {
    const conversation = this.db
      .prepare<ConversationRow, [string]>(
        `SELECT c.id, c.worktree_path, p.permissions_mode
                , c.session_id
         FROM conversations c
         JOIN projects p ON p.id = c.project_id
         WHERE c.id = ?`,
      )
      .get(conversationId);
    if (!conversation) {
      throw new SessionStartError(
        "conversation_not_found",
        `No conversation with id "${conversationId}"`,
      );
    }

    const conflicting = this.db
      .prepare<{ id: string }, [string, string]>(
        `SELECT c.id AS id FROM session_ledger sl
         JOIN conversations c ON c.id = sl.conversation_id
         WHERE c.worktree_path = ? AND c.id != ?`,
      )
      .get(conversation.worktree_path, conversationId);
    if (conflicting) {
      throw new SessionStartError(
        "worktree_in_use",
        `Worktree "${conversation.worktree_path}" is owned by another active conversation`,
      );
    }
    for (const session of this.active.values()) {
      if (
        session.worktree_path === conversation.worktree_path &&
        session.conversation_id !== conversationId
      ) {
        throw new SessionStartError(
          "worktree_in_use",
          `Worktree "${conversation.worktree_path}" is owned by another active conversation`,
        );
      }
    }

    const input = new InputStream();
    if (firstInput) input.push(firstInput);
    const result = this.spawner({
      cwd: conversation.worktree_path,
      input,
      permissionMode: conversation.permissions_mode,
      canUseTool: this.permissions
        ? (toolName, toolInput, context) =>
            this.permissions!.canUseTool(
              conversationId,
              conversation.permissions_mode,
              toolName,
              toolInput,
              context,
            )
        : undefined,
    });

    const initState: {
      resolve: ((info: SessionInfo) => void) | null;
      reject: ((err: unknown) => void) | null;
    } = { resolve: null, reject: null };
    const initPromise = new Promise<SessionInfo>((resolve, reject) => {
      initState.resolve = resolve;
      initState.reject = reject;
    });

    const session: ActiveSession = {
      conversation_id: conversationId,
      worktree_path: conversation.worktree_path,
      sdk_session_id: "",
      host_pid: this.hostPid,
      input,
      abort: result.abort,
    };

    void (async () => {
      try {
        for await (const message of result.iterator) {
          if (message.type === "system" && (message as { subtype?: string }).subtype === "init") {
            const sdkSessionId = (message as { session_id: string }).session_id;
            const slashCommands = (message as { slash_commands?: unknown }).slash_commands;
            if (Array.isArray(slashCommands)) {
              slashCommandRegistry.refreshFromSession(slashCommands as string[]);
            }
            session.sdk_session_id = sdkSessionId;
            this.active.set(conversationId, session);
            this.db.run(
              `INSERT OR REPLACE INTO session_ledger
                 (conversation_id, sdk_session_id, host_pid, started_at)
               VALUES (?, ?, ?, ?)`,
              [conversationId, sdkSessionId, this.hostPid, new Date().toISOString()],
            );
            this.db.run(
              "UPDATE conversations SET session_id = ?, last_active_at = ? WHERE id = ?",
              [sdkSessionId, new Date().toISOString(), conversationId],
            );
            const initEvent: SessionEvent = {
              kind: "session_init",
              sdk_session_id: sdkSessionId,
            };
            this.broadcast(conversationId, initEvent);
            const r = initState.resolve;
            initState.resolve = null;
            r?.({
              conversation_id: conversationId,
              sdk_session_id: sdkSessionId,
              host_pid: this.hostPid,
            });
            continue;
          }

          const event = normalizeMessage(message);
          if (event) this.broadcast(conversationId, event);
        }
        this.cleanup(conversationId, "ended");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const r = initState.resolve;
        const j = initState.reject;
        initState.resolve = null;
        initState.reject = null;
        if (r) {
          j?.(err);
        } else {
          this.broadcast(conversationId, { kind: "error", message });
        }
        this.cleanup(conversationId, "error");
      }
    })();

    return initPromise;
  }

  private broadcast(conversationId: string, event: SessionEvent): void {
    let buffer = this.buffered.get(conversationId);
    if (!buffer) {
      buffer = [];
      this.buffered.set(conversationId, buffer);
    }
    buffer.push(event);
    const group = this.subscribers.get(conversationId);
    if (!group) return;
    for (const listener of group) {
      try {
        listener(event);
      } catch {
        // listener errors must not interrupt other listeners
      }
    }
  }

  private cleanup(conversationId: string, reason: string): void {
    const session = this.active.get(conversationId);
    if (!session) return;
    this.active.delete(conversationId);
    this.permissions?.clearConversation(conversationId);
    this.db.run("DELETE FROM session_ledger WHERE conversation_id = ?", [conversationId]);
    this.broadcast(conversationId, { kind: "session_end", reason });
    this.buffered.delete(conversationId);
  }

  private async needsTakeover(conversationId: string): Promise<boolean> {
    const conversation = this.db
      .prepare<ConversationRow, [string]>(
        `SELECT c.id, c.worktree_path, c.session_id, p.permissions_mode
         FROM conversations c
         JOIN projects p ON p.id = c.project_id
         WHERE c.id = ?`,
      )
      .get(conversationId);
    if (!conversation?.session_id) return false;
    const ledger = this.db
      .prepare<{ conversation_id: string }, [string]>(
        "SELECT conversation_id FROM session_ledger WHERE conversation_id = ?",
      )
      .get(conversationId);
    if (ledger || this.active.has(conversationId)) return false;
    const sessions = await listTranscriptSessions(conversation.worktree_path);
    const transcript = sessions.find((session) => session.session_id === conversation.session_id);
    if (!transcript) return false;
    return Date.now() - transcript.mtimeMs < TAKEOVER_WINDOW_MS;
  }

  private hasRecordedSession(conversationId: string): boolean {
    const row = this.db
      .prepare<{ session_id: string | null }, [string]>(
        "SELECT session_id FROM conversations WHERE id = ?",
      )
      .get(conversationId);
    return typeof row?.session_id === "string" && row.session_id.length > 0;
  }
}

function normalizeMessage(message: SpawnedSDKMessage): SessionEvent | null {
  if (message.type === "assistant") {
    const content = message.message.content;
    if (!Array.isArray(content)) return null;
    const blocks: AssistantBlock[] = [];
    for (const block of content) {
      if (!isObject(block)) continue;
      if (block.type === "text" && typeof block.text === "string") {
        blocks.push({ type: "text", text: block.text });
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        blocks.push({ type: "thinking", text: block.thinking });
      } else if (
        block.type === "tool_use" &&
        typeof block.id === "string" &&
        typeof block.name === "string"
      ) {
        const input = isObject(block.input) ? block.input : {};
        blocks.push({ type: "tool_use", id: block.id, name: block.name, input });
      }
    }
    if (blocks.length === 0) return null;
    return {
      kind: "assistant_message",
      uuid: message.uuid,
      ts: new Date().toISOString(),
      blocks,
    };
  }

  if (message.type === "user") {
    const content = message.message.content;
    if (!Array.isArray(content)) return null;
    const toolResult = content.find(
      (block): block is Record<string, unknown> => isObject(block) && block.type === "tool_result",
    );
    if (!toolResult) return null;
    const inner = toolResult.content;
    let text: string;
    if (typeof inner === "string") {
      text = inner;
    } else if (Array.isArray(inner)) {
      text = inner.map((b) => (isObject(b) && typeof b.text === "string" ? b.text : "")).join("");
    } else {
      text = "";
    }
    return {
      kind: "tool_result",
      uuid: message.uuid,
      ts: new Date().toISOString(),
      tool_use_id: typeof toolResult.tool_use_id === "string" ? toolResult.tool_use_id : "",
      content: text,
      is_error: toolResult.is_error === true,
    };
  }

  if (message.type === "system") {
    const subtype = (message as { subtype?: string }).subtype ?? "";
    const text = (message as { content?: string }).content ?? "";
    return {
      kind: "system",
      uuid: message.uuid,
      ts: new Date().toISOString(),
      subtype,
      text,
    };
  }

  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
