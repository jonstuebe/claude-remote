import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, GitBranch, MessagesSquare, Pin } from "lucide-react";
import { cn } from "../lib/cn";
import { formatRelativeTime } from "../lib/time";
import {
  ApiRequestError,
  getProject,
  listConversations,
  type Conversation,
  type Project,
} from "../lib/api";

export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectDetailRoute,
});

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; project: Project; conversations: Conversation[] }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

function ProjectDetailRoute() {
  const { projectId } = Route.useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const [project, conversations] = await Promise.all([
        getProject(projectId),
        listConversations(projectId),
      ]);
      setState({ kind: "ok", project, conversations });
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
    void refresh();
  }, [refresh]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-screen-md flex-col px-5 py-6">
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
        <ProjectDetail project={state.project} conversations={state.conversations} />
      )}
    </main>
  );
}

function ProjectDetail({
  project,
  conversations,
}: {
  project: Project;
  conversations: Conversation[];
}) {
  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        <p
          className="mt-1 truncate font-mono text-xs text-muted-foreground"
          title={project.repo_path}
        >
          {project.repo_path}
        </p>
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <GitBranch className="size-3" aria-hidden />
          <span className="font-mono">{project.default_branch}</span>
        </div>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Conversations</h2>
        {conversations.length === 0 ? (
          <ConversationsEmpty />
        ) : (
          <ul className="flex flex-col gap-3">
            {conversations.map((conversation) => (
              <ConversationCard key={conversation.id} conversation={conversation} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ConversationCard({ conversation }: { conversation: Conversation }) {
  return (
    <li
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
          </div>
        </div>
      </Link>
    </li>
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
