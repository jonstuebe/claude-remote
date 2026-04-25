import type { AssistantBlock } from "../transcript/reader.ts";

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
  | { kind: "error"; message: string }
  | { kind: "session_end"; reason: string };

export type SpawnInputMessage = {
  type: "user";
  message: { role: "user"; content: string };
};

export type SpawnInput = AsyncIterable<SpawnInputMessage>;

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
      message: { content: unknown };
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
};

export type Spawner = (options: SpawnOptions) => SpawnResult;

export type Listener = (event: SessionEvent) => void;
