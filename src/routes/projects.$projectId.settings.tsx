import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Settings } from "lucide-react";
import {
  ApiRequestError,
  getProject,
  getSettings,
  updateProjectSettings,
  updateUserSettings,
  type Project,
  type SettingsJson,
  type UserSettings,
} from "../lib/api";

export const Route = createFileRoute("/projects/$projectId/settings")({
  component: SettingsRoute,
});

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; project: Project; user: UserSettings; projectSettings: SettingsJson }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

function SettingsRoute() {
  const { projectId } = Route.useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [projectJson, setProjectJson] = useState("{}");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [project, settings] = await Promise.all([getProject(projectId), getSettings(projectId)]);
      setState({
        kind: "ok",
        project,
        user: settings.user,
        projectSettings: settings.project,
      });
      setProjectJson(JSON.stringify(settings.project, null, 2));
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

  const saveUser = async (input: Partial<UserSettings>) => {
    setSaving(true);
    setMessage(null);
    try {
      const user = await updateUserSettings(input);
      setState((prev) => (prev.kind === "ok" ? { ...prev, user } : prev));
      setMessage("User settings saved");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const saveProject = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const parsed = JSON.parse(projectJson) as SettingsJson;
      const projectSettings = await updateProjectSettings(projectId, parsed);
      setState((prev) => (prev.kind === "ok" ? { ...prev, projectSettings } : prev));
      setMessage("Project settings saved");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Project settings must be valid JSON");
    } finally {
      setSaving(false);
    }
  };

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
              <Settings className="size-5 text-muted-foreground" aria-hidden />
              <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{state.project.name}</p>
          </header>

          {message && <Panel>{message}</Panel>}

          <section className="mt-4 rounded-2xl border border-border/60 bg-card p-4">
            <h2 className="font-medium">User settings</h2>
            <label className="mt-4 flex items-center justify-between gap-3 text-sm">
              <span>
                <span className="block font-medium">Keep awake</span>
                <span className="text-xs text-muted-foreground">
                  Runs caffeinate while the server is running.
                </span>
              </span>
              <input
                type="checkbox"
                checked={state.user.keep_awake === true}
                disabled={saving}
                onChange={(e) => void saveUser({ keep_awake: e.target.checked })}
              />
            </label>
            <label className="mt-4 block text-sm font-medium">
              Terminal command template
              <input
                value={state.user.terminal_command_template ?? ""}
                onChange={(e) =>
                  setState((prev) =>
                    prev.kind === "ok"
                      ? {
                          ...prev,
                          user: { ...prev.user, terminal_command_template: e.target.value },
                        }
                      : prev,
                  )
                }
                onBlur={() =>
                  void saveUser({
                    terminal_command_template: state.user.terminal_command_template ?? "",
                  })
                }
                className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 font-mono text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            </label>
          </section>

          <section className="mt-4 rounded-2xl border border-border/60 bg-card p-4">
            <h2 className="font-medium">Project settings</h2>
            <textarea
              value={projectJson}
              onChange={(e) => setProjectJson(e.target.value)}
              rows={12}
              className="mt-3 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => void saveProject()}
                disabled={saving}
                className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                Save project settings
              </button>
            </div>
          </section>
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
