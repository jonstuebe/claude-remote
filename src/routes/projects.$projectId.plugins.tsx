import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Plug, Trash2 } from "lucide-react";
import {
  ApiRequestError,
  getProject,
  installPlugin,
  listPlugins,
  setProjectPluginEnabled,
  uninstallPlugin,
  type PluginInfo,
  type Project,
} from "../lib/api";

export const Route = createFileRoute("/projects/$projectId/plugins")({
  component: PluginManagerRoute,
});

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; project: Project; plugins: PluginInfo[] }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

function PluginManagerRoute() {
  const { projectId } = Route.useParams();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [marketplaceId, setMarketplaceId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [project, plugins] = await Promise.all([getProject(projectId), listPlugins(projectId)]);
      setState({ kind: "ok", project, plugins });
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

  const handleInstall = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = marketplaceId.trim();
    if (!value) return;
    setBusy("install");
    setMessage(null);
    try {
      const output = await installPlugin(value);
      setMarketplaceId("");
      setMessage(output || "Plugin installed");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Install failed");
    } finally {
      setBusy(null);
    }
  };

  const handleToggle = async (plugin: PluginInfo) => {
    setBusy(plugin.name);
    setMessage(null);
    try {
      await setProjectPluginEnabled(projectId, plugin.name, !plugin.enabled);
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const handleUninstall = async (plugin: PluginInfo) => {
    if (!window.confirm(`Uninstall plugin "${plugin.name}"?`)) return;
    setBusy(plugin.name);
    setMessage(null);
    try {
      const output = await uninstallPlugin(plugin.name);
      setMessage(output || "Plugin uninstalled");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Uninstall failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col px-5 py-6">
      <Link
        to="/projects/$projectId"
        params={{ projectId }}
        className="mb-4 inline-flex items-center gap-1 self-start text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        <span>Project</span>
      </Link>

      {state.kind === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}
      {state.kind === "not_found" && <Panel title="Project not found" />}
      {state.kind === "error" && <Panel title={state.message} destructive />}
      {state.kind === "ok" && (
        <>
          <header className="mb-6">
            <div className="flex items-center gap-2">
              <Plug className="size-5 text-muted-foreground" aria-hidden />
              <h1 className="text-2xl font-semibold tracking-tight">Plugins</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{state.project.name}</p>
          </header>

          <form
            onSubmit={handleInstall}
            className="mb-4 flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-4 sm:flex-row"
          >
            <input
              value={marketplaceId}
              onChange={(e) => setMarketplaceId(e.target.value)}
              placeholder="marketplace/plugin-name"
              className="h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
            <button
              type="submit"
              disabled={busy === "install" || marketplaceId.trim().length === 0}
              className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy === "install" ? "Installing…" : "Install"}
            </button>
          </form>

          {message && (
            <pre className="mb-4 whitespace-pre-wrap rounded-lg border border-border/60 bg-muted p-3 text-xs text-muted-foreground">
              {message}
            </pre>
          )}

          {state.plugins.length === 0 ? (
            <Panel title="No plugins installed" />
          ) : (
            <ul className="flex flex-col gap-3">
              {state.plugins.map((plugin) => (
                <li
                  key={plugin.name}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-4"
                >
                  <div className="min-w-0">
                    <h2 className="truncate font-medium">{plugin.name}</h2>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {plugin.path}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleToggle(plugin)}
                      disabled={busy === plugin.name}
                      className="rounded-lg bg-muted px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                    >
                      {plugin.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleUninstall(plugin)}
                      disabled={busy === plugin.name}
                      aria-label={`Uninstall ${plugin.name}`}
                      className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
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

function Panel({ title, destructive = false }: { title: string; destructive?: boolean }) {
  return (
    <div
      className={
        destructive
          ? "rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          : "rounded-2xl border border-border/60 bg-card p-6 text-sm text-muted-foreground"
      }
    >
      {title}
    </div>
  );
}
