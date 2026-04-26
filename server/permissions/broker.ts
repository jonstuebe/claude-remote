import { randomUUID } from "node:crypto";
import type { PermissionMode, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { SessionEvent } from "../sessions/types.ts";

export type PermissionRiskLevel = "medium" | "high";

export type PermissionDecision = "allow" | "deny" | "allow_for_session";

export type PermissionRequestContext = {
  signal?: AbortSignal;
  title?: string;
  description?: string;
  blockedPath?: string;
  decisionReason?: string;
  toolUseID?: string;
};

export type PermissionDenylistRule = {
  tool?: string;
  inputPattern: RegExp;
  riskLevel?: PermissionRiskLevel;
};

export type PermissionBrokerOptions = {
  denylist: PermissionDenylistRule[];
  timeoutMs?: number;
  emit: (conversationId: string, event: SessionEvent) => void;
};

type PendingRequest = {
  id: string;
  conversationId: string;
  tool: string;
  input: Record<string, unknown>;
  signature: string;
  resolve: (result: PermissionResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export class PermissionBroker {
  private readonly denylist: PermissionDenylistRule[];
  private readonly timeoutMs: number;
  private readonly emit: (conversationId: string, event: SessionEvent) => void;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly sessionAllows = new Map<string, Set<string>>();

  constructor(options: PermissionBrokerOptions) {
    this.denylist = options.denylist;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.emit = options.emit;
  }

  canUseTool(
    conversationId: string,
    permissionsMode: PermissionMode,
    tool: string,
    input: Record<string, unknown>,
    context: PermissionRequestContext = {},
  ): Promise<PermissionResult> {
    const signature = inputSignature(tool, input);
    if (this.sessionAllows.get(conversationId)?.has(signature)) {
      return Promise.resolve({ behavior: "allow" });
    }

    const match = this.matchDenylist(tool, input);
    if (permissionsMode === "bypassPermissions" && !match) {
      return Promise.resolve({ behavior: "allow" });
    }

    return this.ask(conversationId, tool, input, signature, context, match?.riskLevel ?? "medium");
  }

  resolve(requestId: string, decision: PermissionDecision): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pending.delete(requestId);

    const allowed = decision === "allow" || decision === "allow_for_session";
    if (decision === "allow_for_session") {
      let allows = this.sessionAllows.get(pending.conversationId);
      if (!allows) {
        allows = new Set();
        this.sessionAllows.set(pending.conversationId, allows);
      }
      allows.add(pending.signature);
    }

    this.emit(pending.conversationId, {
      kind: "permission_decision",
      id: pending.id,
      decision,
      input_locked: this.hasPending(pending.conversationId),
    });

    pending.resolve(
      allowed
        ? { behavior: "allow" }
        : { behavior: "deny", message: "Denied by user", interrupt: true },
    );
    return true;
  }

  clearConversation(conversationId: string): void {
    this.sessionAllows.delete(conversationId);
    for (const request of [...this.pending.values()]) {
      if (request.conversationId !== conversationId) continue;
      clearTimeout(request.timer);
      this.pending.delete(request.id);
      request.resolve({
        behavior: "deny",
        message: "Conversation ended before permission was granted",
        interrupt: true,
      });
    }
  }

  private ask(
    conversationId: string,
    tool: string,
    input: Record<string, unknown>,
    signature: string,
    context: PermissionRequestContext,
    riskLevel: PermissionRiskLevel,
  ): Promise<PermissionResult> {
    const id = context.toolUseID ?? randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        this.emit(conversationId, {
          kind: "permission_decision",
          id,
          decision: "deny",
          input_locked: this.hasPending(conversationId),
        });
        this.emit(conversationId, {
          kind: "system",
          uuid: randomUUID(),
          ts: new Date().toISOString(),
          subtype: "permission_timeout",
          text: "Permission request timed out and was denied.",
        });
        resolve({ behavior: "deny", message: "Permission request timed out", interrupt: true });
      }, this.timeoutMs);

      this.pending.set(id, {
        id,
        conversationId,
        tool,
        input,
        signature,
        resolve,
        timer,
      });

      this.emit(conversationId, {
        kind: "permission_request",
        id,
        tool,
        input,
        summary: summarizePermission(tool, input, context),
        riskLevel,
        input_locked: true,
      });
    });
  }

  private hasPending(conversationId: string): boolean {
    for (const pending of this.pending.values()) {
      if (pending.conversationId === conversationId) return true;
    }
    return false;
  }

  private matchDenylist(
    tool: string,
    input: Record<string, unknown>,
  ): PermissionDenylistRule | null {
    const serialized = stableStringify(input);
    return (
      this.denylist.find((rule) => {
        if (rule.tool && rule.tool !== tool) return false;
        return rule.inputPattern.test(serialized);
      }) ?? null
    );
  }
}

export function defaultPermissionDenylist(): PermissionDenylistRule[] {
  return [
    { tool: "Bash", inputPattern: /\brm\s+-rf\b|\bgit\s+reset\s+--hard\b/, riskLevel: "high" },
    { tool: "Bash", inputPattern: /\bcurl\b|\bwget\b|\bfetch\b/, riskLevel: "medium" },
    { inputPattern: /"\.\.\/|\/etc\/|\/private\/|\/System\//, riskLevel: "high" },
  ];
}

function inputSignature(tool: string, input: Record<string, unknown>): string {
  return `${tool}:${stableStringify(input)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function summarizePermission(
  tool: string,
  input: Record<string, unknown>,
  context: PermissionRequestContext,
): string {
  if (context.title) return context.title;
  if (context.description) return context.description;
  if (typeof input.command === "string") return input.command;
  if (typeof input.file_path === "string") return input.file_path;
  if (context.blockedPath) return context.blockedPath;
  if (context.decisionReason) return context.decisionReason;
  return `${tool} requested permission`;
}
