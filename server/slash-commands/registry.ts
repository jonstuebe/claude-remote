import { homedir } from "node:os";
import { basename, join } from "node:path";
import { readdir } from "node:fs/promises";
import { CONVERSATION_COLORS, isConversationColor } from "../conversations/palette.ts";

export type SlashCommandKind = "tui-replaced" | "server-handled" | "dispatched";

export type SlashCommand = {
  name: string;
  kind: SlashCommandKind;
  description: string;
  argumentHint: string;
  source: "server" | "builtin" | "sdk" | "project" | "user" | "plugin";
};

const SERVER_HANDLED: SlashCommand[] = [
  {
    name: "rename",
    kind: "server-handled",
    description: "Rename the current conversation",
    argumentHint: "<title>",
    source: "server",
  },
  {
    name: "color",
    kind: "server-handled",
    description: `Set the conversation color (${CONVERSATION_COLORS.join(", ")})`,
    argumentHint: "<color>",
    source: "server",
  },
];

const BUILTIN_DEFINITIONS = [
  ["plugins", "tui-replaced", "Open the plugin manager", ""],
  ["config", "tui-replaced", "Open settings", ""],
  ["login", "tui-replaced", "Login is handled in the host terminal", ""],
  ["agents", "tui-replaced", "Open the agent browser", ""],
  ["permissions", "tui-replaced", "Open permission settings", ""],
  ["mcp", "tui-replaced", "Open MCP server picker", ""],
  ["effort", "dispatched", "Set reasoning effort", "<level>"],
  ["compact", "dispatched", "Compact the current conversation", ""],
  ["context", "dispatched", "Show context usage", ""],
  ["usage", "dispatched", "Show usage", ""],
  ["cost", "dispatched", "Show session cost", ""],
  ["model", "dispatched", "Switch model", "<model>"],
  ["review", "dispatched", "Ask Claude to review changes", ""],
] as const;

const BUILTINS: SlashCommand[] = BUILTIN_DEFINITIONS.map(([name, kind, description, argumentHint]) => ({
  name,
  kind,
  description,
  argumentHint,
  source: "builtin" as const,
}));

export type ServerHandledAction =
  | { kind: "rename"; title: string }
  | { kind: "color"; color: string | null };

export type ServerHandledParseResult =
  | { ok: true; action: ServerHandledAction }
  | { ok: false; error: string };

export function listServerHandledCommands(): SlashCommand[] {
  return SERVER_HANDLED.slice();
}

export type SlashCommandRegistryOptions = {
  projectPath?: string;
  userHome?: string;
  sdkCommands?: Array<string | { name?: string; description?: string; argumentHint?: string }>;
};

export class SlashCommandRegistry {
  private sdkCommands: SlashCommand[] = [];

  refreshFromSession(commands: SlashCommandRegistryOptions["sdkCommands"] = []): void {
    this.sdkCommands = commands.flatMap((command) => sdkCommand(command));
  }

  async listForSession(options: SlashCommandRegistryOptions = {}): Promise<SlashCommand[]> {
    if (options.sdkCommands) this.refreshFromSession(options.sdkCommands);
    const userHome = options.userHome ?? process.env.HOME ?? homedir();
    const projectCommands = options.projectPath
      ? await readCommandDirectory(join(options.projectPath, ".claude", "commands"), "project")
      : [];
    const userCommands = await readCommandDirectory(join(userHome, ".claude", "commands"), "user");
    const pluginCommands = await readPluginCommands(join(userHome, ".claude", "plugins"));
    return dedupe([
      ...SERVER_HANDLED,
      ...BUILTINS,
      ...this.sdkCommands,
      ...projectCommands,
      ...userCommands,
      ...pluginCommands,
    ]);
  }

  async search(query: string, options: SlashCommandRegistryOptions = {}): Promise<SlashCommand[]> {
    const needle = query.toLowerCase().replace(/^\//, "");
    const commands = await this.listForSession(options);
    if (!needle) return commands;
    return commands.filter(
      (command) =>
        command.name.toLowerCase().includes(needle) ||
        command.description.toLowerCase().includes(needle),
    );
  }
}

export const slashCommandRegistry = new SlashCommandRegistry();

const COMMAND_PATTERN = /^\/([a-zA-Z][a-zA-Z0-9_:-]*)(?:\s+([\s\S]*))?$/;

export function parseSlashCommand(input: string): { name: string; rest: string } | null {
  const trimmed = input.trim();
  const match = COMMAND_PATTERN.exec(trimmed);
  if (!match) return null;
  return { name: match[1]!.toLowerCase(), rest: (match[2] ?? "").trim() };
}

export function isServerHandled(name: string): boolean {
  return SERVER_HANDLED.some((c) => c.name === name);
}

export function parseServerHandled(input: string): ServerHandledParseResult | null {
  const parsed = parseSlashCommand(input);
  if (!parsed) return null;
  if (parsed.name === "rename") {
    if (parsed.rest.length === 0) {
      return { ok: false, error: "Usage: /rename <title>" };
    }
    return { ok: true, action: { kind: "rename", title: parsed.rest } };
  }
  if (parsed.name === "color") {
    const value = parsed.rest.toLowerCase();
    if (value.length === 0 || value === "none" || value === "clear") {
      return { ok: true, action: { kind: "color", color: null } };
    }
    if (!isConversationColor(value)) {
      return {
        ok: false,
        error: `Unknown color "${parsed.rest}". Available: ${CONVERSATION_COLORS.join(", ")}`,
      };
    }
    return { ok: true, action: { kind: "color", color: value } };
  }
  return null;
}

async function readPluginCommands(pluginsDir: string): Promise<SlashCommand[]> {
  const entries = await readdir(pluginsDir, { withFileTypes: true }).catch(() => []);
  const commands: SlashCommand[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginName = entry.name;
    for (const dirName of ["commands", "skills"]) {
      const dir = join(pluginsDir, pluginName, dirName);
      const discovered = await readCommandDirectory(dir, "plugin", `${pluginName}:`);
      commands.push(...discovered);
    }
  }
  return commands;
}

async function readCommandDirectory(
  dir: string,
  source: SlashCommand["source"],
  prefix = "",
): Promise<SlashCommand[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const commands: SlashCommand[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      commands.push(...(await readCommandDirectory(path, source, prefix)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const parsed = parseCommandMarkdown(await Bun.file(path).text());
    const stem = basename(entry.name, ".md");
    commands.push({
      name: `${prefix}${stem}`,
      kind: routeKind(`${prefix}${stem}`),
      description: parsed.description || `${prefix}${stem}`,
      argumentHint: parsed.argumentHint,
      source,
    });
  }
  return commands;
}

function sdkCommand(
  command: string | { name?: string; description?: string; argumentHint?: string },
): SlashCommand[] {
  const name = typeof command === "string" ? command.replace(/^\//, "") : command.name?.replace(/^\//, "");
  if (!name) return [];
  return [
    {
      name,
      kind: routeKind(name),
      description: typeof command === "string" ? name : command.description || name,
      argumentHint: typeof command === "string" ? "" : command.argumentHint || "",
      source: "sdk",
    },
  ];
}

function routeKind(name: string): SlashCommandKind {
  if (SERVER_HANDLED.some((command) => command.name === name)) return "server-handled";
  if (BUILTINS.some((command) => command.name === name && command.kind === "tui-replaced")) {
    return "tui-replaced";
  }
  return "dispatched";
}

function dedupe(commands: SlashCommand[]): SlashCommand[] {
  const seen = new Set<string>();
  const result: SlashCommand[] = [];
  for (const command of commands) {
    if (seen.has(command.name)) continue;
    seen.add(command.name);
    result.push(command);
  }
  return result;
}

function parseCommandMarkdown(text: string): { description: string; argumentHint: string } {
  if (!text.startsWith("---")) return { description: "", argumentHint: "" };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { description: "", argumentHint: "" };
  const frontmatter = text.slice(3, end).trim();
  const values = new Map<string, string>();
  for (const line of frontmatter.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line
      .slice(idx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    values.set(key, value);
  }
  return {
    description: values.get("description") ?? "",
    argumentHint: values.get("argument-hint") ?? values.get("argumentHint") ?? "",
  };
}
