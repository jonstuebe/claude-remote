import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Bot, ChevronLeft } from "lucide-react";
import { ApiRequestError, getProject, listAgents, type AgentInfo, type Project } from "../lib/api";

export const Route = createFileRoute("/projects/$projectId/agents")({
  component: AgentsRoute,
});

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; project: Project; agents: AgentInfo[] }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

function AgentsRoute() {
  const { projectId } = Route.useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const [project, agents] = await Promise.all([getProject(projectId), listAgents(projectId)]);
      setState({ kind: "ok", project, agents });
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        setState({ kind: "not_found" });
        return;
      }
      setState({ kind: "error", message: err instanceof Error ? err.message : "Load failed" });
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-5 py-6">
      <Link
        to="/projects/$projectId"
        params={{ projectId }}
        className="mb-4 inline-flex items-center gap-1 self-start text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        <span>Project</span>
      </Link>

      {state.kind === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}
      {state.kind === "not_found" && <Panel>Project not found</Panel>}
      {state.kind === "error" && <Panel destructive>{state.message}</Panel>}
      {state.kind === "ok" && (
        <>
          <header className="mb-6">
            <div className="flex items-center gap-2">
              <Bot className="size-5 text-muted-foreground" aria-hidden />
              <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{state.project.name}</p>
          </header>

          {state.agents.length === 0 ? (
            <Panel>No agents found in project or user Claude config.</Panel>
          ) : (
            <ul className="flex flex-col gap-3">
              {state.agents.map((agent) => (
                <li
                  key={`${agent.source}:${agent.name}`}
                  className="rounded-2xl border border-border/60 bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-mono font-medium">@{agent.name}</h2>
                      {agent.description && (
                        <p className="mt-1 text-sm text-muted-foreground">{agent.description}</p>
                      )}
                    </div>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {agent.source}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {agent.model && <span>model {agent.model}</span>}
                    {agent.tools.length > 0 && <span>tools {agent.tools.join(", ")}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

function Panel({ children, destructive = false }: React.PropsWithChildren<{ destructive?: boolean }>) {
  return (
    <div
      className={
        destructive
          ? "rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          : "rounded-2xl border border-border/60 bg-card p-4 text-sm text-muted-foreground"
      }
    >
      {children}
    </div>
  );
}
