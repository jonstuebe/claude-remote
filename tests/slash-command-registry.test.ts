import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SlashCommandRegistry,
  listServerHandledCommands,
  parseServerHandled,
} from "../server/slash-commands/registry.ts";

describe("Slash Command Registry", () => {
  test("contributes rename and color as server-handled commands", () => {
    const commands = listServerHandledCommands();

    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "rename", kind: "server-handled" }),
        expect.objectContaining({ name: "color", kind: "server-handled" }),
      ]),
    );
  });

  test("parses rename and color actions without dispatching to the SDK", () => {
    expect(parseServerHandled("/rename Better title")).toEqual({
      ok: true,
      action: { kind: "rename", title: "Better title" },
    });
    expect(parseServerHandled("/color blue")).toEqual({
      ok: true,
      action: { kind: "color", color: "blue" },
    });
    expect(parseServerHandled("/color clear")).toEqual({
      ok: true,
      action: { kind: "color", color: null },
    });
  });

  test("returns validation feedback for malformed server-handled commands", () => {
    expect(parseServerHandled("/rename")).toMatchObject({ ok: false });
    expect(parseServerHandled("/color nope")).toMatchObject({ ok: false });
    expect(parseServerHandled("/effort high")).toBeNull();
  });

  test("merges SDK, project, user, plugin, built-in, and server commands", async () => {
    const temp = mkdtempSync(join(tmpdir(), "claude-remote-slash-"));
    try {
      const project = join(temp, "project");
      const home = join(temp, "home");
      mkdirSync(join(project, ".claude", "commands"), { recursive: true });
      mkdirSync(join(home, ".claude", "commands"), { recursive: true });
      mkdirSync(join(home, ".claude", "plugins", "plug", "commands"), { recursive: true });
      writeFileSync(
        join(project, ".claude", "commands", "ship.md"),
        "---\ndescription: Ship it\nargument-hint: <target>\n---\n",
      );
      writeFileSync(join(home, ".claude", "commands", "note.md"), "---\ndescription: Note\n---\n");
      writeFileSync(
        join(home, ".claude", "plugins", "plug", "commands", "do.md"),
        "---\ndescription: Plugin do\n---\n",
      );

      const registry = new SlashCommandRegistry();
      const commands = await registry.listForSession({
        projectPath: project,
        userHome: home,
        sdkCommands: ["effort", "sdk-only"],
      });

      expect(commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "rename", kind: "server-handled" }),
          expect.objectContaining({ name: "plugins", kind: "tui-replaced" }),
          expect.objectContaining({ name: "effort", kind: "dispatched" }),
          expect.objectContaining({
            name: "ship",
            source: "project",
            description: "Ship it",
            argumentHint: "<target>",
          }),
          expect.objectContaining({ name: "note", source: "user" }),
          expect.objectContaining({ name: "plug:do", source: "plugin" }),
          expect.objectContaining({ name: "sdk-only", source: "sdk" }),
        ]),
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test("search filters by prefix or description and deduplication is stable", async () => {
    const temp = mkdtempSync(join(tmpdir(), "claude-remote-slash-dedupe-"));
    try {
      const project = join(temp, "project");
      const home = join(temp, "home");
      mkdirSync(join(project, ".claude", "commands"), { recursive: true });
      mkdirSync(join(home, ".claude", "commands"), { recursive: true });
      writeFileSync(join(project, ".claude", "commands", "dup.md"), "---\ndescription: Project\n---\n");
      writeFileSync(join(home, ".claude", "commands", "dup.md"), "---\ndescription: User\n---\n");

      const registry = new SlashCommandRegistry();
      const commands = await registry.search("project", { projectPath: project, userHome: home });

      expect(commands).toEqual([expect.objectContaining({ name: "dup", source: "project" })]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
