import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { $ } from "bun";

export type PluginInfo = {
  name: string;
  path: string;
  enabled: boolean;
};

export type PluginCommandResult = {
  ok: boolean;
  output: string;
};

type ProjectPluginSettings = {
  disabledPlugins?: string[];
};

function userHome(): string {
  return process.env.HOME ?? homedir();
}

function projectSettingsPath(projectPath: string): string {
  return join(projectPath, ".claude", "settings.json");
}

async function readProjectSettings(projectPath: string): Promise<ProjectPluginSettings> {
  const file = Bun.file(projectSettingsPath(projectPath));
  if (!(await file.exists())) return {};
  try {
    const parsed = JSON.parse(await file.text()) as ProjectPluginSettings;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function writeProjectSettings(projectPath: string, settings: ProjectPluginSettings): Promise<void> {
  const path = projectSettingsPath(projectPath);
  await mkdir(join(projectPath, ".claude"), { recursive: true });
  await Bun.write(path, JSON.stringify(settings, null, 2) + "\n");
}

export async function listPlugins(projectPath?: string): Promise<PluginInfo[]> {
  const pluginsDir = join(userHome(), ".claude", "plugins");
  const entries = await readdir(pluginsDir, { withFileTypes: true }).catch(() => []);
  const settings = projectPath ? await readProjectSettings(projectPath) : {};
  const disabled = new Set(settings.disabledPlugins ?? []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: join(pluginsDir, entry.name),
      enabled: !disabled.has(entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function setPluginEnabled(
  projectPath: string,
  pluginName: string,
  enabled: boolean,
): Promise<void> {
  const settings = await readProjectSettings(projectPath);
  const disabled = new Set(settings.disabledPlugins ?? []);
  if (enabled) disabled.delete(pluginName);
  else disabled.add(pluginName);
  await writeProjectSettings(projectPath, {
    ...settings,
    disabledPlugins: [...disabled].sort(),
  });
}

export async function installPlugin(marketplaceId: string): Promise<PluginCommandResult> {
  const result = await $`claude plugin install ${marketplaceId}`.quiet().nothrow();
  return {
    ok: result.exitCode === 0,
    output: result.stdout.toString() + result.stderr.toString(),
  };
}

export async function uninstallPlugin(name: string): Promise<PluginCommandResult> {
  const result = await $`claude plugin uninstall ${name}`.quiet().nothrow();
  return {
    ok: result.exitCode === 0,
    output: result.stdout.toString() + result.stderr.toString(),
  };
}
