import type { Database } from "bun:sqlite";
import {
  deleteProject,
  getProject,
  listProjects,
  ProjectValidationError,
  registerProject,
  type Project,
} from "../projects/registry.ts";

export type ApiContext = {
  db: Database;
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

function projectsListUrl(pathname: string): boolean {
  return pathname === "/api/projects" || pathname === "/api/projects/";
}

function projectByIdMatch(pathname: string): string | null {
  const m = /^\/api\/projects\/([^/]+)\/?$/.exec(pathname);
  return m ? decodeURIComponent(m[1]!) : null;
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function handleCreateProject(req: Request, ctx: ApiContext): Promise<Response> {
  const body = await readJson(req);
  if (!isPlainObject(body)) {
    return json(400, {
      error: { code: "invalid_body", message: "Request body must be a JSON object" },
    });
  }

  const name = typeof body.name === "string" ? body.name : "";
  const repoPath = typeof body.repo_path === "string" ? body.repo_path : "";

  try {
    const project = await registerProject(ctx.db, { name, repo_path: repoPath });
    return json(201, project);
  } catch (err) {
    if (err instanceof ProjectValidationError) {
      const status = err.code === "already_registered" ? 409 : 400;
      return json(status, {
        error: { code: err.code, field: err.field, message: err.message },
      });
    }
    throw err;
  }
}

function handleListProjects(ctx: ApiContext): Response {
  const projects: Project[] = listProjects(ctx.db);
  return json(200, { projects });
}

function handleGetProject(id: string, ctx: ApiContext): Response {
  const project = getProject(ctx.db, id);
  if (!project) {
    return json(404, { error: { code: "not_found", message: `No project with id "${id}"` } });
  }
  return json(200, project);
}

function handleDeleteProject(id: string, ctx: ApiContext): Response {
  const removed = deleteProject(ctx.db, id);
  if (!removed) {
    return json(404, { error: { code: "not_found", message: `No project with id "${id}"` } });
  }
  return new Response(null, { status: 204 });
}

export async function handleApi(req: Request, ctx: ApiContext): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/")) return null;

  if (projectsListUrl(url.pathname)) {
    if (req.method === "GET") return handleListProjects(ctx);
    if (req.method === "POST") return handleCreateProject(req, ctx);
    return json(405, {
      error: {
        code: "method_not_allowed",
        message: `Method ${req.method} not allowed on ${url.pathname}`,
      },
    });
  }

  const id = projectByIdMatch(url.pathname);
  if (id) {
    if (req.method === "GET") return handleGetProject(id, ctx);
    if (req.method === "DELETE") return handleDeleteProject(id, ctx);
    return json(405, {
      error: {
        code: "method_not_allowed",
        message: `Method ${req.method} not allowed on ${url.pathname}`,
      },
    });
  }

  return json(404, { error: { code: "not_found", message: `Unknown API route: ${url.pathname}` } });
}
