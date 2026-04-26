import { $ } from "bun";

export type LaunchTerminalInput = {
  template: string;
  worktreePath: string;
  sessionId: string | null;
};

export async function launchTerminal(input: LaunchTerminalInput): Promise<void> {
  const command = input.template
    .replaceAll("{worktree_path}", shellEscape(input.worktreePath))
    .replaceAll("{session_id}", shellEscape(input.sessionId ?? ""));
  const result = await $`sh -lc ${command}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString().trim() || "Terminal command failed");
  }
}

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
