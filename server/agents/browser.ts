import { homedir } from "node:os";
import { basename, join } from "node:path";
import { readdir } from "node:fs/promises";

export type AgentInfo = {
  name: string;
  description: string;
  model: string | null;
  tools: string[];
  source: "project" | "user";
  path: string;
};

export async function listAgents(projectPath: string, userHome = process.env.HOME ?? homedir()) {
  const [projectAgents, userAgents] = await Promise.all([
    readAgents(join(projectPath, ".claude", "agents"), "project"),
    readAgents(join(userHome, ".claude", "agents"), "user"),
  ]);
  const seen = new Set<string>();
  const agents: AgentInfo[] = [];
  for (const agent of [...projectAgents, ...userAgents]) {
    if (seen.has(agent.name)) continue;
    seen.add(agent.name);
    agents.push(agent);
  }
  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

async function readAgents(dir: string, source: AgentInfo["source"]): Promise<AgentInfo[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const agents: AgentInfo[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const path = join(dir, entry.name);
    const frontmatter = parseFrontmatter(await Bun.file(path).text());
    const name = frontmatter.get("name") || basename(entry.name, ".md");
    const tools = (frontmatter.get("tools") ?? "")
      .split(",")
      .map((tool) => tool.trim())
      .filter(Boolean);
    agents.push({
      name,
      description: frontmatter.get("description") ?? "",
      model: frontmatter.get("model") ?? null,
      tools,
      source,
      path,
    });
  }
  return agents;
}

function parseFrontmatter(text: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!text.startsWith("---")) return values;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return values;
  for (const line of text.slice(3, end).trim().split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    values.set(
      line.slice(0, idx).trim(),
      line
        .slice(idx + 1)
        .trim()
        .replace(/^['"]|['"]$/g, ""),
    );
  }
  return values;
}
