import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listPlugins, setPluginEnabled } from "../server/plugins/manager.ts";

let tempDir: string;
let previousHome: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "claude-remote-plugins-"));
  previousHome = process.env.HOME;
  process.env.HOME = join(tempDir, "home");
});

afterEach(() => {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Plugin Manager", () => {
  test("lists installed plugins from the user plugins directory", async () => {
    mkdirSync(join(process.env.HOME!, ".claude", "plugins", "alpha"), { recursive: true });
    mkdirSync(join(process.env.HOME!, ".claude", "plugins", "beta"), { recursive: true });

    const plugins = await listPlugins();

    expect(plugins.map((plugin) => plugin.name)).toEqual(["alpha", "beta"]);
    expect(plugins.every((plugin) => plugin.enabled)).toBe(true);
  });

  test("toggles project-level enablement in project settings", async () => {
    const project = join(tempDir, "project");
    mkdirSync(project, { recursive: true });
    mkdirSync(join(process.env.HOME!, ".claude", "plugins", "alpha"), { recursive: true });

    await setPluginEnabled(project, "alpha", false);
    expect(await listPlugins(project)).toEqual([
      expect.objectContaining({ name: "alpha", enabled: false }),
    ]);

    await setPluginEnabled(project, "alpha", true);
    expect(await listPlugins(project)).toEqual([
      expect.objectContaining({ name: "alpha", enabled: true }),
    ]);
  });
});
