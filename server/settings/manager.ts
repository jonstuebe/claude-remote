import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export type SettingsJson = Record<string, unknown>;

export type UserSettings = SettingsJson & {
  keep_awake?: boolean;
  terminal_command_template?: string;
};

export type SettingsManagerOptions = {
  userHome?: string;
  serverPid?: number;
  spawnCaffeinate?: (pid: number) => { kill: () => void };
};

const DEFAULT_TERMINAL_TEMPLATE =
  "ghostty --working-directory={worktree_path} -e claude --resume {session_id}";

export class SettingsManager {
  private readonly userHome: string;
  private readonly serverPid: number;
  private readonly spawnCaffeinate: (pid: number) => { kill: () => void };
  private caffeinate: { kill: () => void } | null = null;

  constructor(options: SettingsManagerOptions = {}) {
    this.userHome = options.userHome ?? process.env.HOME ?? homedir();
    this.serverPid = options.serverPid ?? process.pid;
    this.spawnCaffeinate =
      options.spawnCaffeinate ??
      ((pid) => {
        const proc = Bun.spawn(["caffeinate", "-i", "-s", "-w", String(pid)], {
          stdout: "ignore",
          stderr: "ignore",
        });
        return { kill: () => proc.kill() };
      });
  }

  async initialize(): Promise<void> {
    const settings = await this.readUserSettings();
    if (settings.keep_awake === true) this.enableCaffeinate();
  }

  async readUserSettings(): Promise<UserSettings> {
    const settings = await readJson(this.userSettingsPath());
    return {
      ...settings,
      keep_awake: settings.keep_awake === true,
      terminal_command_template:
        typeof settings.terminal_command_template === "string"
          ? settings.terminal_command_template
          : DEFAULT_TERMINAL_TEMPLATE,
    };
  }

  async writeUserSettings(input: Partial<UserSettings>): Promise<UserSettings> {
    const current = await this.readUserSettings();
    const next: UserSettings = { ...current, ...input };
    await writeJson(this.userSettingsPath(), next);
    if (input.keep_awake !== undefined) {
      if (input.keep_awake) this.enableCaffeinate();
      else this.disableCaffeinate();
    }
    return next;
  }

  async readProjectSettings(projectPath: string): Promise<SettingsJson> {
    return readJson(this.projectSettingsPath(projectPath));
  }

  async writeProjectSettings(projectPath: string, settings: SettingsJson): Promise<SettingsJson> {
    await writeJson(this.projectSettingsPath(projectPath), settings);
    return settings;
  }

  stop(): void {
    this.disableCaffeinate();
  }

  private enableCaffeinate(): void {
    if (this.caffeinate) return;
    this.caffeinate = this.spawnCaffeinate(this.serverPid);
  }

  private disableCaffeinate(): void {
    this.caffeinate?.kill();
    this.caffeinate = null;
  }

  private userSettingsPath(): string {
    return join(this.userHome, ".claude", "settings.json");
  }

  private projectSettingsPath(projectPath: string): string {
    return join(projectPath, ".claude", "settings.json");
  }
}

async function readJson(path: string): Promise<SettingsJson> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  try {
    const parsed = JSON.parse(await file.text());
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeJson(path: string, value: SettingsJson): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await Bun.write(path, JSON.stringify(value, null, 2) + "\n");
}
