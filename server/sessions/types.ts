import type { PermissionMode, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { AssistantBlock } from "../transcript/reader.ts";
import type {
  PermissionDecision,
  PermissionRequestContext,
  PermissionRiskLevel,
} from "../permissions/broker.ts";

export type UsageSnapshot = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  model: string | null;
  ts: string;
};

export type SessionEvent =
  | { kind: "session_init"; sdk_session_id: string }
  | { kind: "user_message"; uuid: string; ts: string; text: string }
  | { kind: "assistant_message"; uuid: string; ts: string; blocks: AssistantBlock[] }
  | {
      kind: "tool_result";
      uuid: string;
      ts: string;
      tool_use_id: string;
      content: string;
      is_error: boolean;
    }
  | { kind: "system"; uuid: string; ts: string; subtype: string; text: string }
  | {
      kind: "permission_request";
      id: string;
      tool: string;
      input: Record<string, unknown>;
      summary: string;
      riskLevel: PermissionRiskLevel;
      input_locked: boolean;
    }
  | {
      kind: "permission_decision";
      id: string;
      decision: PermissionDecision;
      input_locked: boolean;
    }
  | ({ kind: "usage_updated" } & UsageSnapshot)
  | { kind: "error"; message: string }
  | { kind: "session_end"; reason: string };

export type SpawnInputMessage = {
  type: "user";
  message: { role: "user"; content: string };
};

export type SpawnInput = AsyncIterable<SpawnInputMessage>;

export type SDKAssistantUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  [key: string]: unknown;
};

export type SpawnedSDKMessage =
  | {
      type: "system";
      subtype: "init";
      uuid: string;
      session_id: string;
      [key: string]: unknown;
    }
  | {
      type: "system";
      subtype: string;
      uuid: string;
      session_id: string;
      content?: string;
      [key: string]: unknown;
    }
  | {
      type: "assistant";
      uuid: string;
      session_id: string;
      message: { content: unknown; model?: string; usage?: SDKAssistantUsage };
      [key: string]: unknown;
    }
  | {
      type: "user";
      uuid: string;
      session_id: string;
      message: { role: string; content: unknown };
      [key: string]: unknown;
    }
  | {
      type: "result";
      uuid: string;
      session_id: string;
      [key: string]: unknown;
    };

export type SpawnResult = {
  iterator: AsyncIterable<SpawnedSDKMessage>;
  abort: () => void;
};

export type SpawnOptions = {
  cwd: string;
  input: SpawnInput;
  permissionMode: PermissionMode;
  canUseTool?: (
    toolName: string,
    input: Record<string, unknown>,
    context: PermissionRequestContext,
  ) => Promise<PermissionResult>;
};

export type Spawner = (options: SpawnOptions) => SpawnResult;

export type Listener = (event: SessionEvent) => void;
