import { createFileRoute } from "@tanstack/react-router";
import { FolderGit2 } from "lucide-react";

export const Route = createFileRoute("/")({ component: ProjectListRoute });

function ProjectListRoute() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-screen-md flex-col px-5 py-6">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
      </header>
      <EmptyState />
    </main>
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
        Register a directory on your machine to drive Claude Code from your phone. Project
        registration lands in a later slice.
      </p>
    </div>
  );
}
