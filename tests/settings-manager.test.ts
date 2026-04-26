import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "../server/settings/manager.ts";

let tempDir: string;
let kills: number;
let spawns: number;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "claude-remote-settings-"));
  kills = 0;
  spawns = 0;
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeManager() {
  return new SettingsManager({
    userHome: join(tempDir, "home"),
    serverPid: 123,
    spawnCaffeinate: (pid) => {
      expect(pid).toBe(123);
      spawns += 1;
      return { kill: () => (kills += 1) };
    },
  });
}

describe("SettingsManager", () => {
  test("reads defaults and persists user settings", async () => {
    const manager = makeManager();

    expect(await manager.readUserSettings()).toMatchObject({
      keep_awake: false,
      terminal_command_template: expect.stringContaining("{worktree_path}"),
    });

    const updated = await manager.writeUserSettings({
      keep_awake: true,
      terminal_command_template: "terminal {worktree_path} {session_id}",
    });

    expect(updated.keep_awake).toBe(true);
    expect(spawns).toBe(1);
    expect((await manager.readUserSettings()).terminal_command_template).toBe(
      "terminal {worktree_path} {session_id}",
    );

    await manager.writeUserSettings({ keep_awake: false });
    expect(kills).toBe(1);
  });

  test("reads and writes project settings", async () => {
    const project = join(tempDir, "project");
    mkdirSync(project, { recursive: true });
    const manager = makeManager();

    await manager.writeProjectSettings(project, { model: "opus" });

    expect(await manager.readProjectSettings(project)).toEqual({ model: "opus" });
  });
});
