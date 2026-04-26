import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { FolderGit2, GitBranch, Plus, Trash2, X } from "lucide-react";
import { cn } from "../lib/cn";
import {
  ApiRequestError,
  deleteProject,
  listProjects,
  registerProject,
  type Project,
} from "../lib/api";

export const Route = createFileRoute("/")({ component: ProjectListRoute });

type FieldErrors = { name?: string; repo_path?: string; form?: string };

function ProjectListRoute() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await listProjects();
      setProjects(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load projects");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRegistered = useCallback((project: Project) => {
    setProjects((current) => (current ? [...current, project] : [project]));
    setShowForm(false);
  }, []);

  const handleDelete = useCallback(async (project: Project) => {
    const ok = window.confirm(
      `Remove "${project.name}" from the registry?\n\nThis only removes the entry. Files at ${project.repo_path} are left alone.`,
    );
    if (!ok) return;
    try {
      await deleteProject(project.id);
      setProjects((current) => (current ? current.filter((p) => p.id !== project.id) : current));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Delete failed");
    }
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-screen-md flex-col px-5 py-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition",
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
          <span>{showForm ? "Cancel" : "Register"}</span>
        </button>
      </header>

      {showForm && <RegisterForm onRegistered={handleRegistered} />}

      {loadError && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {projects === null && !loadError ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : projects && projects.length === 0 ? (
        <EmptyState />
      ) : projects ? (
        <ul className="mt-2 flex flex-col gap-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} onDelete={handleDelete} />
          ))}
        </ul>
      ) : null}
    </main>
  );
}

function RegisterForm({ onRegistered }: { onRegistered: (project: Project) => void }) {
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setSubmitting(true);
    try {
      const project = await registerProject({ name, repo_path: repoPath });
      onRegistered(project);
      setName("");
      setRepoPath("");
    } catch (err) {
      if (err instanceof ApiRequestError) {
        const field = err.body.field;
        if (field === "name" || field === "repo_path") {
          setErrors({ [field]: err.body.message });
        } else {
          setErrors({ form: err.body.message });
        }
      } else {
        setErrors({ form: err instanceof Error ? err.message : "Registration failed" });
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
      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-name" className="text-sm font-medium">
          Name
        </label>
        <input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-project"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className={inputClass(!!errors.name)}
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="project-repo-path" className="text-sm font-medium">
          Repo path
        </label>
        <input
          id="project-repo-path"
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          placeholder="/Users/me/code/my-project"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className={cn(inputClass(!!errors.repo_path), "font-mono text-sm")}
        />
        {errors.repo_path && <p className="text-xs text-destructive">{errors.repo_path}</p>}
        <p className="text-xs text-muted-foreground">
          Absolute path to a git repository on this machine.
        </p>
      </div>

      {errors.form && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {errors.form}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Registering…" : "Register project"}
        </button>
      </div>
    </form>
  );
}

function ProjectCard({
  project,
  onDelete,
}: {
  project: Project;
  onDelete: (project: Project) => void;
}) {
  return (
    <li className="relative rounded-2xl border border-border/60 bg-card transition hover:border-border">
      <Link
        to="/projects/$projectId"
        params={{ projectId: project.id }}
        className="block p-4 pr-14"
      >
        <h2 className="truncate text-base font-semibold">{project.name}</h2>
        <p
          className="mt-1 truncate font-mono text-xs text-muted-foreground"
          title={project.repo_path}
        >
          {project.repo_path}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            <GitBranch className="size-3" aria-hidden />
            <span className="font-mono">{project.current_branch ?? project.default_branch}</span>
          </span>
          {project.dirty && (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
              Dirty
            </span>
          )}
        </div>
      </Link>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete(project);
        }}
        aria-label={`Delete ${project.name}`}
        className="absolute right-3 top-3 inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <FolderGit2 className="size-6" aria-hidden />
      </div>
      <h2 className="text-lg font-medium">No projects yet</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Register a directory on your machine to drive Claude Code from your phone.
      </p>
    </div>
  );
}

function inputClass(hasError: boolean): string {
  return cn(
    "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition",
    "border-input focus:border-ring focus:ring-2 focus:ring-ring/30",
    hasError && "border-destructive focus:border-destructive focus:ring-destructive/30",
  );
}
