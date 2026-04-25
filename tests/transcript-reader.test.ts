import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTranscript, sanitizeProjectKey, transcriptPath } from "../server/transcript/reader.ts";

let tempHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "claude-remote-transcripts-"));
  originalHome = process.env.HOME;
  process.env.HOME = tempHome;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tempHome, { recursive: true, force: true });
});

function writeTranscript(cwd: string, sessionId: string, lines: unknown[]): void {
  const dir = join(tempHome, ".claude", "projects", sanitizeProjectKey(cwd));
  mkdirSync(dir, { recursive: true });
  const body = lines.map((l) => JSON.stringify(l)).join("\n");
  writeFileSync(join(dir, `${sessionId}.jsonl`), body);
}

function writeRawTranscript(cwd: string, sessionId: string, raw: string): void {
  const dir = join(tempHome, ".claude", "projects", sanitizeProjectKey(cwd));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), raw);
}

describe("Transcript Reader", () => {
  test("sanitizeProjectKey replaces slashes with dashes", () => {
    expect(sanitizeProjectKey("/Users/alice/code/foo")).toBe("-Users-alice-code-foo");
  });

  test("transcriptPath joins ~/.claude/projects/<sanitized>/<session>.jsonl", () => {
    const path = transcriptPath({
      cwd: "/Users/alice/repo",
      sessionId: "abc-123",
    });
    expect(path).toBe(join(tempHome, ".claude/projects/-Users-alice-repo/abc-123.jsonl"));
  });

  test("returns [] for missing file", async () => {
    const messages = await readTranscript({
      cwd: "/tmp/missing",
      sessionId: "no-such-session",
    });
    expect(messages).toEqual([]);
  });

  test("returns [] for empty file", async () => {
    writeRawTranscript("/tmp/empty", "session-1", "");
    const messages = await readTranscript({
      cwd: "/tmp/empty",
      sessionId: "session-1",
    });
    expect(messages).toEqual([]);
  });

  test("normalizes a string-content user message", async () => {
    writeTranscript("/repo/x", "s1", [
      {
        type: "user",
        uuid: "u1",
        timestamp: "2026-04-25T10:00:00.000Z",
        message: { role: "user", content: "Hello" },
      },
    ]);

    const messages = await readTranscript({ cwd: "/repo/x", sessionId: "s1" });
    expect(messages).toEqual([
      { kind: "user_message", uuid: "u1", ts: "2026-04-25T10:00:00.000Z", text: "Hello" },
    ]);
  });

  test("normalizes an assistant message into text/thinking/tool_use blocks", async () => {
    writeTranscript("/repo/x", "s2", [
      {
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-04-25T10:01:00.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hmm" },
            { type: "text", text: "Hi there" },
            { type: "tool_use", id: "t1", name: "Read", input: { path: "/x" } },
          ],
        },
      },
    ]);

    const messages = await readTranscript({ cwd: "/repo/x", sessionId: "s2" });
    expect(messages).toHaveLength(1);
    const msg = messages[0]!;
    expect(msg.kind).toBe("assistant_message");
    if (msg.kind !== "assistant_message") return;
    expect(msg.blocks).toEqual([
      { type: "thinking", text: "hmm" },
      { type: "text", text: "Hi there" },
      { type: "tool_use", id: "t1", name: "Read", input: { path: "/x" } },
    ]);
  });

  test("extracts tool_result blocks from user-message arrays", async () => {
    writeTranscript("/repo/x", "s3", [
      {
        type: "user",
        uuid: "tr1",
        timestamp: "2026-04-25T10:02:00.000Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
        },
      },
    ]);

    const messages = await readTranscript({ cwd: "/repo/x", sessionId: "s3" });
    expect(messages).toEqual([
      {
        kind: "tool_result",
        uuid: "tr1",
        ts: "2026-04-25T10:02:00.000Z",
        tool_use_id: "t1",
        content: "ok",
        is_error: false,
      },
    ]);
  });

  test("flattens tool_result content arrays into a single text", async () => {
    writeTranscript("/repo/x", "s4", [
      {
        type: "user",
        uuid: "tr2",
        timestamp: "2026-04-25T10:02:00.000Z",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "t2",
              is_error: true,
              content: [
                { type: "text", text: "error " },
                { type: "text", text: "details" },
              ],
            },
          ],
        },
      },
    ]);

    const messages = await readTranscript({ cwd: "/repo/x", sessionId: "s4" });
    expect(messages).toEqual([
      {
        kind: "tool_result",
        uuid: "tr2",
        ts: "2026-04-25T10:02:00.000Z",
        tool_use_id: "t2",
        content: "error details",
        is_error: true,
      },
    ]);
  });

  test("skips file-history-snapshot, sidechain, and meta rows", async () => {
    writeTranscript("/repo/x", "s5", [
      { type: "file-history-snapshot", uuid: "fhs1", timestamp: "2026-04-25T10:00:00.000Z" },
      {
        type: "user",
        isSidechain: true,
        uuid: "side1",
        timestamp: "2026-04-25T10:00:01.000Z",
        message: { role: "user", content: "subagent" },
      },
      {
        type: "user",
        isMeta: true,
        uuid: "meta1",
        timestamp: "2026-04-25T10:00:02.000Z",
        message: { role: "user", content: "meta" },
      },
      {
        type: "user",
        uuid: "u1",
        timestamp: "2026-04-25T10:00:03.000Z",
        message: { role: "user", content: "real" },
      },
    ]);

    const messages = await readTranscript({ cwd: "/repo/x", sessionId: "s5" });
    expect(messages.map((m) => m.uuid)).toEqual(["u1"]);
  });

  test("tolerates malformed JSON lines and a malformed trailing line without a newline", async () => {
    const good = JSON.stringify({
      type: "user",
      uuid: "u1",
      timestamp: "t",
      message: { role: "user", content: "hello" },
    });
    const raw = `${good}\nnot json\n{"this is": "missing fields"}\nstill bad`;
    writeRawTranscript("/repo/x", "s6", raw);

    const messages = await readTranscript({ cwd: "/repo/x", sessionId: "s6" });
    expect(messages.map((m) => m.uuid)).toEqual(["u1"]);
  });

  test("preserves order across mixed message kinds", async () => {
    writeTranscript("/repo/x", "s7", [
      {
        type: "user",
        uuid: "u1",
        timestamp: "2026-04-25T10:00:00.000Z",
        message: { role: "user", content: "Run something" },
      },
      {
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-04-25T10:00:01.000Z",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "Bash", input: { cmd: "ls" } }],
        },
      },
      {
        type: "user",
        uuid: "tr1",
        timestamp: "2026-04-25T10:00:02.000Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "a b c" }],
        },
      },
      {
        type: "assistant",
        uuid: "a2",
        timestamp: "2026-04-25T10:00:03.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      },
    ]);

    const messages = await readTranscript({ cwd: "/repo/x", sessionId: "s7" });
    expect(messages.map((m) => `${m.kind}:${m.uuid}`)).toEqual([
      "user_message:u1",
      "assistant_message:a1",
      "tool_result:tr1",
      "assistant_message:a2",
    ]);
  });
});
