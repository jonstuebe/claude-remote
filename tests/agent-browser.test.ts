import { describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listAgents } from "../server/agents/browser.ts";

describe("Agent Browser", () => {
  test("lists project and user agents with frontmatter", async () => {
    const temp = mkdtempSync(join(tmpdir(), "claude-remote-agents-"));
    try {
      const project = join(temp, "project");
      const home = join(temp, "home");
      mkdirSync(join(project, ".claude", "agents"), { recursive: true });
      mkdirSync(join(home, ".claude", "agents"), { recursive: true });
      writeFileSync(
        join(project, ".claude", "agents", "reviewer.md"),
        "---\nname: reviewer\ndescription: Reviews code\nmodel: opus\ntools: Read, Grep\n---\n",
      );
      writeFileSync(
        join(home, ".claude", "agents", "planner.md"),
        "---\ndescription: Plans work\n---\n",
      );

      const agents = await listAgents(project, home);

      expect(agents).toEqual([
        expect.objectContaining({ name: "planner", description: "Plans work", source: "user" }),
        expect.objectContaining({
          name: "reviewer",
          description: "Reviews code",
          model: "opus",
          tools: ["Read", "Grep"],
          source: "project",
        }),
      ]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
