import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTerminal } from "../server/terminal/launcher.ts";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "claude-remote-terminal-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Terminal Launcher", () => {
  test("substitutes worktree and session placeholders", async () => {
    const output = join(tempDir, "out.txt");

    await launchTerminal({
      template: `printf "%s|%s" {worktree_path} {session_id} > ${output}`,
      worktreePath: "/tmp/my worktree",
      sessionId: "sdk-session",
    });

    expect(readFileSync(output, "utf8")).toBe("/tmp/my worktree|sdk-session");
  });
});
