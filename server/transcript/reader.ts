import { homedir } from "node:os";
import { join } from "node:path";
import { readdir, stat } from "node:fs/promises";

function defaultHome(): string {
  return process.env.HOME ?? homedir();
}

export type AssistantBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export type TranscriptMessage =
  | {
      kind: "user_message";
      uuid: string;
      ts: string;
      text: string;
    }
  | {
      kind: "assistant_message";
      uuid: string;
      ts: string;
      blocks: AssistantBlock[];
    }
  | {
      kind: "tool_result";
      uuid: string;
      ts: string;
      tool_use_id: string;
      content: string;
      is_error: boolean;
    }
  | {
      kind: "system";
      uuid: string;
      ts: string;
      subtype: string;
      text: string;
    };

export type TranscriptLocation = {
  cwd: string;
  sessionId: string;
};

export function sanitizeProjectKey(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

export function transcriptPath(location: TranscriptLocation): string {
  return join(
    defaultHome(),
    ".claude",
    "projects",
    sanitizeProjectKey(location.cwd),
    `${location.sessionId}.jsonl`,
  );
}

export type TranscriptSession = {
  session_id: string;
  path: string;
  mtimeMs: number;
};

export async function listTranscriptSessions(cwd: string): Promise<TranscriptSession[]> {
  const dir = join(defaultHome(), ".claude", "projects", sanitizeProjectKey(cwd));
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const sessions: TranscriptSession[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const path = join(dir, entry.name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) continue;
    sessions.push({
      session_id: entry.name.slice(0, -".jsonl".length),
      path,
      mtimeMs: info.mtimeMs,
    });
  }
  return sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export async function readTranscript(location: TranscriptLocation): Promise<TranscriptMessage[]> {
  const path = transcriptPath(location);
  const exists = await stat(path).catch(() => null);
  if (!exists?.isFile()) return [];

  const file = Bun.file(path);
  const text = await file.text();
  const messages: TranscriptMessage[] = [];
  for (const line of text.split("\n")) {
    const message = parseLine(line);
    if (message) messages.push(message);
  }
  return messages;
}

function parseLine(line: string): TranscriptMessage | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let row: unknown;
  try {
    row = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isObject(row)) return null;
  if (row.isSidechain === true) return null;
  if (row.type === "file-history-snapshot") return null;
  if (row.isMeta === true) return null;

  const uuid = typeof row.uuid === "string" ? row.uuid : "";
  const ts = typeof row.timestamp === "string" ? row.timestamp : "";
  if (!uuid) return null;

  if (row.type === "user") return parseUserRow(row, uuid, ts);
  if (row.type === "assistant") return parseAssistantRow(row, uuid, ts);
  if (row.type === "system") return parseSystemRow(row, uuid, ts);
  return null;
}

function parseUserRow(
  row: Record<string, unknown>,
  uuid: string,
  ts: string,
): TranscriptMessage | null {
  const message = isObject(row.message) ? row.message : null;
  if (!message) return null;
  const content = message.content;

  if (typeof content === "string") {
    return { kind: "user_message", uuid, ts, text: content };
  }

  if (Array.isArray(content)) {
    const toolResult = content.find(
      (block): block is Record<string, unknown> => isObject(block) && block.type === "tool_result",
    );
    if (toolResult) {
      const inner = toolResult.content;
      let text: string;
      if (typeof inner === "string") {
        text = inner;
      } else if (Array.isArray(inner)) {
        text = inner.map((b) => (isObject(b) && typeof b.text === "string" ? b.text : "")).join("");
      } else {
        text = "";
      }
      const toolUseId = typeof toolResult.tool_use_id === "string" ? toolResult.tool_use_id : "";
      return {
        kind: "tool_result",
        uuid,
        ts,
        tool_use_id: toolUseId,
        content: text,
        is_error: toolResult.is_error === true,
      };
    }

    const text = content
      .map((b) => (isObject(b) && b.type === "text" && typeof b.text === "string" ? b.text : ""))
      .join("");
    if (text.length === 0) return null;
    return { kind: "user_message", uuid, ts, text };
  }

  return null;
}

function parseAssistantRow(
  row: Record<string, unknown>,
  uuid: string,
  ts: string,
): TranscriptMessage | null {
  const message = isObject(row.message) ? row.message : null;
  if (!message) return null;
  const content = message.content;
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
  return { kind: "assistant_message", uuid, ts, blocks };
}

function parseSystemRow(
  row: Record<string, unknown>,
  uuid: string,
  ts: string,
): TranscriptMessage | null {
  const subtype = typeof row.subtype === "string" ? row.subtype : "";
  const text = typeof row.content === "string" ? row.content : "";
  if (subtype === "" && text === "") return null;
  return { kind: "system", uuid, ts, subtype, text };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
