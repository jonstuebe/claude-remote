import { resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { $ } from "bun";

export class NotAGitRepoError extends Error {
  readonly path: string;
  constructor(path: string, reason: string) {
    super(`"${path}" is not a git repository: ${reason}`);
    this.name = "NotAGitRepoError";
    this.path = path;
  }
}

async function pathIsDirectory(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info?.isDirectory() ?? false;
}

export async function assertGitRepo(repoPath: string): Promise<string> {
  const absolute = resolve(repoPath);

  if (!(await pathIsDirectory(absolute))) {
    throw new NotAGitRepoError(absolute, "path does not exist or is not a directory");
  }

  // git's --show-toplevel reports the canonical (symlink-resolved) path, so
  // compare against realpath to avoid false negatives on systems where the
  // input path traverses symlinks (e.g. macOS /var → /private/var).
  const canonical = await realpath(absolute);

  const result = await $`git -C ${canonical} rev-parse --show-toplevel`.quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new NotAGitRepoError(absolute, "git rev-parse reported no working tree at this path");
  }

  const toplevel = result.stdout.toString().trim();
  if (toplevel !== canonical) {
    throw new NotAGitRepoError(
      absolute,
      `path is inside a git repo but not its root (root is "${toplevel}")`,
    );
  }

  return canonical;
}

export async function detectDefaultBranch(repoPath: string): Promise<string> {
  const absolute = resolve(repoPath);

  const remoteHead = await $`git -C ${absolute} symbolic-ref --short refs/remotes/origin/HEAD`
    .quiet()
    .nothrow();
  if (remoteHead.exitCode === 0) {
    const ref = remoteHead.stdout.toString().trim();
    const slash = ref.indexOf("/");
    if (slash >= 0) return ref.slice(slash + 1);
    if (ref.length > 0) return ref;
  }

  const current = await $`git -C ${absolute} branch --show-current`.quiet().nothrow();
  if (current.exitCode === 0) {
    const branch = current.stdout.toString().trim();
    if (branch.length > 0) return branch;
  }

  return "main";
}
