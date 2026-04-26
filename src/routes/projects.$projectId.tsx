import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  Bot,
  GitBranch,
  MessagesSquare,
  Pin,
  Plug,
  Plus,
  Settings,
  X,
} from "lucide-react";
import { cn } from "../lib/cn";
import { formatRelativeTime } from "../lib/time";
import {
  ApiRequestError,
  createConversation,
  getProject,
  importConversation,
  listProjectConversationState,
  type Conversation,
  type CreateConversationInput,
  type ImportableWorktree,
  type Project,
} from "../lib/api";
import { ConversationContextMenu } from "../components/conversation-actions";
import { COLOR_SWATCHES, isConversationColor } from "../lib/slash-commands";

export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectDetailRoute,
});

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ok";
      project: Project;
      conversations: Conversation[];
      importableWorktrees: ImportableWorktree[];
    }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

function ProjectDetailRoute() {
  const { projectId } = Route.useParams();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isSubpage = /\/(plugins|agents|settings)\/?$/.test(pathname);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
        const [project, conversationState] = await Promise.all([
        getProject(projectId),
          listProjectConversationState(projectId),
      ]);
      setState({
        kind: "ok",
        project,
        conversations: conversationState.conversations,
        importableWorktrees: conversationState.importable_worktrees,
      });
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        setState({ kind: "not_found" });
        return;
      }
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to load project",
      });
    }
  }, [projectId]);

  useEffect(() => {
    if (isSubpage) return;
    void refresh();
  }, [isSubpage, refresh]);

  if (isSubpage) return <Outlet />;

  return (
    <main className="flex min-h-dvh flex-col px-5 py-6">
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1 self-start text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        <span>Projects</span>
      </Link>

      {state.kind === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}

      {state.kind === "not_found" && (
        <div className="rounded-2xl border border-border/60 bg-card p-6 text-sm">
          <h1 className="text-lg font-semibold">Project not found</h1>
          <p className="mt-2 text-muted-foreground">
            The project may have been removed from the registry.
          </p>
        </div>
      )}

      {state.kind === "error" && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {state.message}
        </div>
      )}

      {state.kind === "ok" && (
        <ProjectDetail
          project={state.project}
          conversations={state.conversations}
          importableWorktrees={state.importableWorktrees}
          onConversationCreated={(conversation) =>
            setState({
              kind: "ok",
              project: state.project,
              conversations: [...state.conversations, conversation],
              importableWorktrees: state.importableWorktrees,
            })
          }
          onConversationImported={(conversation, path) =>
            setState({
              kind: "ok",
              project: state.project,
              conversations: [...state.conversations, conversation],
              importableWorktrees: state.importableWorktrees.filter((item) => item.path !== path),
            })
          }
          onConversationUpdated={(conversation) =>
            setState({
              kind: "ok",
              project: state.project,
              conversations: state.conversations.map((item) =>
                item.id === conversation.id ? conversation : item,
              ),
              importableWorktrees: state.importableWorktrees,
            })
          }
          onConversationDeleted={(id) =>
            setState({
              kind: "ok",
              project: state.project,
              conversations: state.conversations.filter((item) => item.id !== id),
              importableWorktrees: state.importableWorktrees,
            })
          }
        />
      )}
    </main>
  );
}

function ProjectDetail({
  project,
  conversations,
  importableWorktrees,
  onConversationCreated,
  onConversationImported,
  onConversationUpdated,
  onConversationDeleted,
}: {
  project: Project;
  conversations: Conversation[];
  importableWorktrees: ImportableWorktree[];
  onConversationCreated: (conversation: Conversation) => void;
  onConversationImported: (conversation: Conversation, path: string) => void;
  onConversationUpdated: (conversation: Conversation) => void;
  onConversationDeleted: (id: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);

  return (
    <>
      <header className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <div className="flex gap-2">
            <Link
              to="/projects/$projectId/plugins"
              params={{ projectId: project.id }}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-muted px-3 text-sm font-medium transition hover:bg-accent"
            >
              <Plug className="size-4" aria-hidden />
              <span>Plugins</span>
            </Link>
            <Link
              to="/projects/$projectId/agents"
              params={{ projectId: project.id }}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-muted px-3 text-sm font-medium transition hover:bg-accent"
            >
              <Bot className="size-4" aria-hidden />
              <span>Agents</span>
            </Link>
            <Link
              to="/projects/$projectId/settings"
              params={{ projectId: project.id }}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-muted px-3 text-sm font-medium transition hover:bg-accent"
            >
              <Settings className="size-4" aria-hidden />
              <span>Settings</span>
            </Link>
          </div>
        </div>
        <p
          className="mt-1 truncate font-mono text-xs text-muted-foreground"
          title={project.repo_path}
        >
          {project.repo_path}
        </p>
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <GitBranch className="size-3" aria-hidden />
          <span className="font-mono">{project.current_branch ?? project.default_branch}</span>
        </div>
        {project.dirty && (
          <span className="ml-2 inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
            Dirty
          </span>
        )}
      </header>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Conversations</h2>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition",
              showForm
                ? "bg-muted text-foreground hover:bg-accent"
                : "bg-primary text-primary-foreground hover:opacity-90",
            )}
          >
            {showForm ? (
              <X className="size-4" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
            <span>{showForm ? "Cancel" : "New"}</span>
          </button>
        </div>

        {showForm && (
          <NewConversationForm
            project={project}
            existingPaths={new Set(conversations.map((c) => c.worktree_path))}
            onCreated={(conversation) => {
              onConversationCreated(conversation);
              setShowForm(false);
            }}
          />
        )}

        {importableWorktrees.length > 0 && (
          <ImportableWorktrees
            projectId={project.id}
            worktrees={importableWorktrees}
            onImported={onConversationImported}
          />
        )}

        {conversations.length === 0 ? (
          <ConversationsEmpty />
        ) : (
          <ul className="flex flex-col gap-3">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <ConversationContextMenu
                  conversation={conversation}
                  project={project}
                  onUpdated={onConversationUpdated}
                  onDeleted={onConversationDeleted}
                >
                  <ConversationCard conversation={conversation} />
                </ConversationContextMenu>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ImportableWorktrees({
  projectId,
  worktrees,
  onImported,
}: {
  projectId: string;
  worktrees: ImportableWorktree[];
  onImported: (conversation: Conversation, path: string) => void;
}) {
  const [importingPath, setImportingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async (worktree: ImportableWorktree) => {
    setImportingPath(worktree.path);
    setError(null);
    try {
      const conversation = await importConversation(projectId, worktree.path);
      onImported(conversation, worktree.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportingPath(null);
    }
  };

  return (
    <div className="mb-4 rounded-2xl border border-dashed border-border/70 bg-card p-4">
      <h3 className="text-sm font-medium">Importable worktrees</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        These git worktrees exist on disk but are not attached to a conversation yet.
      </p>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <ul className="mt-3 flex flex-col gap-2">
        {worktrees.map((worktree) => (
          <li
            key={worktree.path}
            className="flex items-center justify-between gap-3 rounded-lg bg-background/60 p-3"
          >
            <div className="min-w-0">
              <div className="truncate font-mono text-xs">{worktree.path}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>{worktree.branch ?? "detached"}</span>
                {worktree.session_id && <span>session {worktree.session_id.slice(0, 8)}</span>}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleImport(worktree)}
              disabled={importingPath === worktree.path}
              className="inline-flex h-8 shrink-0 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importingPath === worktree.path ? "Importing…" : "Import"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

type NewConversationMode = "main" | "new-worktree" | "existing-branch";
type NewConversationErrors = { branch?: string; base_branch?: string; form?: string };

function NewConversationForm({
  project,
  existingPaths,
  onCreated,
}: {
  project: Project;
  existingPaths: Set<string>;
  onCreated: (conversation: Conversation) => void;
}) {
  const [mode, setMode] = useState<NewConversationMode>("new-worktree");
  const [branch, setBranch] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [errors, setErrors] = useState<NewConversationErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const mainAlreadyClaimed = existingPaths.has(project.repo_path);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setSubmitting(true);
    try {
      const input: CreateConversationInput =
        mode === "main"
          ? { mode }
          : mode === "new-worktree"
            ? {
                mode,
                branch,
                ...(baseBranch.trim() ? { base_branch: baseBranch.trim() } : {}),
              }
            : { mode, branch };
      const conversation = await createConversation(project.id, input);
      onCreated(conversation);
      setBranch("");
      setBaseBranch("");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        const field = err.body.field;
        if (field === "branch" || field === "base_branch") {
          setErrors({ [field]: err.body.message });
        } else {
          setErrors({ form: err.body.message });
        }
      } else {
        setErrors({ form: err instanceof Error ? err.message : "Create failed" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="mb-6 flex flex-col gap-4 rounded-2xl border border-border/60 bg-card p-5"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Mode</legend>
        <ModeOption
          checked={mode === "main"}
          onChange={() => setMode("main")}
          label="Attach to main worktree"
          description={
            mainAlreadyClaimed
              ? "Already attached to another conversation."
              : "Use the project's main checkout."
          }
          disabled={mainAlreadyClaimed}
        />
        <ModeOption
          checked={mode === "new-worktree"}
          onChange={() => setMode("new-worktree")}
          label="Create new worktree on a new branch"
          description="Branches off a base branch into a fresh worktree directory."
        />
        <ModeOption
          checked={mode === "existing-branch"}
          onChange={() => setMode("existing-branch")}
          label="Attach to existing branch"
          description="Adds a worktree that checks out a branch that already exists."
        />
      </fieldset>

      {mode !== "main" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="conversation-branch" className="text-sm font-medium">
            Branch
          </label>
          <input
            id="conversation-branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder={mode === "new-worktree" ? "feature/my-thing" : "existing-branch"}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className={cn(inputClass(!!errors.branch), "font-mono text-sm")}
          />
          {errors.branch && <p className="text-xs text-destructive">{errors.branch}</p>}
        </div>
      )}

      {mode === "new-worktree" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="conversation-base-branch" className="text-sm font-medium">
            Base branch <span className="text-muted-foreground">(optional)</span>
          </label>
          <input
            id="conversation-base-branch"
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
            placeholder={project.default_branch}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className={cn(inputClass(!!errors.base_branch), "font-mono text-sm")}
          />
          {errors.base_branch && <p className="text-xs text-destructive">{errors.base_branch}</p>}
          <p className="text-xs text-muted-foreground">
            Defaults to <span className="font-mono">{project.default_branch}</span>.
          </p>
        </div>
      )}

      {errors.form && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {errors.form}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting || (mode === "main" && mainAlreadyClaimed)}
          className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create conversation"}
        </button>
      </div>
    </form>
  );
}

function ModeOption({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-3 transition",
        checked ? "border-primary/60" : "border-border/60 hover:border-border",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input
        type="radio"
        name="conversation-mode"
        className="mt-1"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span className="flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function inputClass(hasError: boolean): string {
  return cn(
    "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition",
    "border-input focus:border-ring focus:ring-2 focus:ring-ring/30",
    hasError && "border-destructive focus:border-destructive focus:ring-destructive/30",
  );
}

function ConversationCard({ conversation }: { conversation: Conversation }) {
  const swatchClass =
    conversation.color && isConversationColor(conversation.color)
      ? COLOR_SWATCHES[conversation.color]
      : null;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card transition hover:border-border",
        conversation.is_default ? "border-primary/40" : "border-border/60",
      )}
    >
      <Link
        to="/conversations/$conversationId"
        params={{ conversationId: conversation.id }}
        className="flex items-start justify-between gap-3 p-4"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {swatchClass && (
              <span
                className={cn("size-3 shrink-0 rounded-full", swatchClass)}
                aria-label={`${conversation.color} conversation`}
              />
            )}
            {conversation.is_default && (
              <Pin className="size-3.5 shrink-0 text-primary" aria-label="Default conversation" />
            )}
            <h3 className="truncate text-base font-semibold">{conversation.title}</h3>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5">
              <GitBranch className="size-3" aria-hidden />
              <span className="font-mono">{conversation.branch}</span>
            </span>
            <time dateTime={conversation.last_active_at}>
              {formatRelativeTime(conversation.last_active_at)}
            </time>
            {conversation.status === "orphaned" && (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
                Orphaned
              </span>
            )}
            {conversation.status === "archived" && (
              <span className="rounded-full bg-muted px-2 py-0.5 font-medium">Archived</span>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}

function ConversationsEmpty() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 px-6 py-12 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <MessagesSquare className="size-5" aria-hidden />
      </div>
      <p className="text-sm text-muted-foreground">No conversations yet.</p>
    </div>
  );
}
