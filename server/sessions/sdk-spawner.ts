import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SpawnedSDKMessage, Spawner, SpawnInputMessage } from "./types.ts";

export const sdkSpawner: Spawner = ({ cwd, input, permissionMode, canUseTool }) => {
  const abortController = new AbortController();

  const sdkInput = {
    [Symbol.asyncIterator](): AsyncIterator<{
      type: "user";
      message: { role: "user"; content: string };
      session_id?: string;
    }> {
      const inner = input[Symbol.asyncIterator]();
      return {
        async next() {
          const result = await inner.next();
          if (result.done) {
            return { value: undefined as never, done: true };
          }
          return { value: result.value as SpawnInputMessage, done: false };
        },
      };
    },
  } as unknown as Parameters<typeof query>[0]["prompt"];

  const q = query({
    prompt: sdkInput,
    options: {
      cwd,
      permissionMode,
      allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
      canUseTool,
      settingSources: ["project", "user"],
      abortController,
      env: {
        ...process.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: "claude-remote/0.1",
      },
    },
  });

  const iterator: AsyncIterable<SpawnedSDKMessage> = {
    [Symbol.asyncIterator](): AsyncIterator<SpawnedSDKMessage> {
      const inner = q[Symbol.asyncIterator]();
      return {
        async next() {
          const result = await inner.next();
          if (result.done) {
            return { value: undefined as unknown as SpawnedSDKMessage, done: true };
          }
          return { value: result.value as unknown as SpawnedSDKMessage, done: false };
        },
      };
    },
  };

  return {
    iterator,
    abort: () => abortController.abort(),
  };
};
