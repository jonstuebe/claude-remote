import type { Database } from "bun:sqlite";
import type { Project } from "./projects/registry.ts";
import { listProjects } from "./projects/registry.ts";
import {
  ensureDefaultConversation,
  listConversations,
  type Conversation,
} from "./conversations/registry.ts";
import { detectCurrentBranch, isGitDirty } from "./git.ts";
import { listTranscriptSessions } from "./transcript/reader.ts";
import { listWorktrees, type WorktreeEntry } from "./worktrees/manager.ts";

export type ImportableWorktree = {
  path: string;
  branch: string | null;
  session_id: string | null;
};

export type ProjectRuntimeStatus = {
  current_branch: string | null;
  dirty: boolean;
};

export type ReconcileResult = {
  conversations: Conversation[];
  importable_worktrees: ImportableWorktree[];
};

function worktreeByPath(entries: WorktreeEntry[]): Map<string, WorktreeEntry> {
  return new Map(entries.map((entry) => [entry.path, entry]));
}

function updateConversationExternalState(
  db: Database,
  conversation: Conversation,
  entry: WorktreeEntry | null,
): void {
  if (conversation.status === "archived") return;

  if (!entry) {
    if (conversation.status !== "orphaned") {
      db.run("UPDATE conversations SET status = ? WHERE id = ?", ["orphaned", conversation.id]);
    }
    return;
  }

  const branch = entry.branch ?? conversation.branch;
  db.run("UPDATE conversations SET branch = ?, status = ? WHERE id = ?", [
    branch,
    "active",
    conversation.id,
  ]);
}

export async function getProjectRuntimeStatus(project: Project): Promise<ProjectRuntimeStatus> {
  const [currentBranch, dirty] = await Promise.all([
    detectCurrentBranch(project.repo_path),
    isGitDirty(project.repo_path),
  ]);
  return { current_branch: currentBranch, dirty };
}

export async function reconcileProject(
  db: Database,
  project: Project,
): Promise<ReconcileResult> {
  await ensureDefaultConversation(db, project);

  const entries = await listWorktrees(project.repo_path);
  const entriesByPath = worktreeByPath(entries);
  const before = listConversations(db, project.id);

  for (const conversation of before) {
    updateConversationExternalState(db, conversation, entriesByPath.get(conversation.worktree_path) ?? null);
  }

  const after = listConversations(db, project.id);
  const claimed = new Set(after.map((conversation) => conversation.worktree_path));
  const importable: ImportableWorktree[] = [];

  for (const entry of entries) {
    if (entry.path === project.repo_path) continue;
    if (claimed.has(entry.path)) continue;
    const sessions = await listTranscriptSessions(entry.path);
    importable.push({
      path: entry.path,
      branch: entry.branch,
      session_id: sessions[0]?.session_id ?? null,
    });
  }

  return { conversations: after, importable_worktrees: importable };
}

export async function reconcileAllProjects(db: Database): Promise<void> {
  for (const project of listProjects(db)) {
    await reconcileProject(db, project);
  }
}
