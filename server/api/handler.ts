import type { Database } from "bun:sqlite";
import {
  deleteProject,
  getProject,
  listProjects,
  ProjectValidationError,
  registerProject,
  type Project,
} from "../projects/registry.ts";
import {
  ConversationNotFoundError,
  ConversationValidationError,
  createConversation,
  deleteConversation,
  ensureDefaultConversation,
  getConversation,
  listConversations,
  updateConversation,
  type Conversation,
  type CreateConversationInput,
  type UpdateConversationInput,
} from "../conversations/registry.ts";
import { isConversationColor } from "../conversations/palette.ts";
import type { SessionManager } from "../sessions/manager.ts";
import { SessionStartError } from "../sessions/manager.ts";
import { readTranscript } from "../transcript/reader.ts";
import { WorktreeError } from "../worktrees/manager.ts";
import type { MetaBroadcaster } from "../ws/meta-broadcaster.ts";
import { listServerHandledCommands } from "../slash-commands/registry.ts";

export type ApiContext = {
  db: Database;
  sessions: SessionManager;
  meta: MetaBroadcaster;
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

function projectConversationsMatch(pathname: string): string | null {
  const m = /^\/api\/projects\/([^/]+)\/conversations\/?$/.exec(pathname);
  return m ? decodeURIComponent(m[1]!) : null;
}

function conversationByIdMatch(pathname: string): string | null {
  const m = /^\/api\/conversations\/([^/]+)\/?$/.exec(pathname);
  return m ? decodeURIComponent(m[1]!) : null;
}

function conversationMessagesMatch(pathname: string): string | null {
  const m = /^\/api\/conversations\/([^/]+)\/messages\/?$/.exec(pathname);
  return m ? decodeURIComponent(m[1]!) : null;
}

function slashCommandsUrl(pathname: string): boolean {
  return pathname === "/api/slash-commands" || pathname === "/api/slash-commands/";
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

async function handleListProjectConversations(
  projectId: string,
  ctx: ApiContext,
): Promise<Response> {
  const project = getProject(ctx.db, projectId);
  if (!project) {
    return json(404, {
      error: { code: "not_found", message: `No project with id "${projectId}"` },
    });
  }
  await ensureDefaultConversation(ctx.db, project);
  const conversations: Conversation[] = listConversations(ctx.db, project.id);
  return json(200, { conversations });
}

function parseCreateConversationInput(body: Record<string, unknown>):
  | CreateConversationInput
  | {
      error: { code: string; field: string; message: string };
    } {
  const mode = body.mode;
  if (mode === "main") return { mode: "main" };
  if (mode === "new-worktree" || mode === "existing-branch") {
    if (typeof body.branch !== "string") {
      return {
        error: {
          code: "invalid_body",
          field: "branch",
          message: "branch is required for this mode",
        },
      };
    }
    if (mode === "new-worktree") {
      const baseBranch = typeof body.base_branch === "string" ? body.base_branch : undefined;
      return { mode, branch: body.branch, base_branch: baseBranch };
    }
    return { mode, branch: body.branch };
  }
  return {
    error: {
      code: "invalid_body",
      field: "mode",
      message: 'mode must be "main", "new-worktree", or "existing-branch"',
    },
  };
}

async function handleCreateProjectConversation(
  projectId: string,
  req: Request,
  ctx: ApiContext,
): Promise<Response> {
  const project = getProject(ctx.db, projectId);
  if (!project) {
    return json(404, {
      error: { code: "not_found", message: `No project with id "${projectId}"` },
    });
  }
  const body = await readJson(req);
  if (!isPlainObject(body)) {
    return json(400, {
      error: { code: "invalid_body", message: "Request body must be a JSON object" },
    });
  }
  const parsed = parseCreateConversationInput(body);
  if ("error" in parsed) return json(400, { error: parsed.error });

  await ensureDefaultConversation(ctx.db, project);
  try {
    const conversation = await createConversation(ctx.db, project, parsed);
    return json(201, conversation);
  } catch (err) {
    if (err instanceof ConversationValidationError) {
      const status = err.code === "worktree_in_use" ? 409 : 400;
      return json(status, {
        error: { code: err.code, field: err.field, message: err.message },
      });
    }
    throw err;
  }
}

function handleGetConversation(id: string, ctx: ApiContext): Response {
  const conversation = getConversation(ctx.db, id);
  if (!conversation) {
    return json(404, {
      error: { code: "not_found", message: `No conversation with id "${id}"` },
    });
  }
  return json(200, conversation);
}

async function handleUpdateConversation(
  id: string,
  req: Request,
  ctx: ApiContext,
): Promise<Response> {
  const body = await readJson(req);
  if (!isPlainObject(body)) {
    return json(400, {
      error: { code: "invalid_body", message: "Request body must be a JSON object" },
    });
  }

  const input: UpdateConversationInput = {};
  if ("title" in body) {
    if (typeof body.title !== "string") {
      return json(400, {
        error: { code: "invalid_body", field: "title", message: "title must be a string" },
      });
    }
    input.title = body.title;
  }
  if ("color" in body) {
    if (body.color !== null && !isConversationColor(body.color)) {
      return json(400, {
        error: {
          code: "invalid_color",
          field: "color",
          message: "color must be null or a preset palette name",
        },
      });
    }
    input.color = body.color;
  }
  if ("archived" in body) {
    if (typeof body.archived !== "boolean") {
      return json(400, {
        error: { code: "invalid_body", field: "archived", message: "archived must be a boolean" },
      });
    }
    input.archived = body.archived;
  }

  try {
    const conversation = updateConversation(ctx.db, id, input);
    ctx.meta.broadcast(id, { kind: "conversation_meta_updated", conversation });
    return json(200, conversation);
  } catch (err) {
    if (err instanceof ConversationNotFoundError) {
      return json(404, { error: { code: "not_found", message: err.message } });
    }
    if (err instanceof ConversationValidationError) {
      return json(400, {
        error: { code: err.code, field: err.field ?? undefined, message: err.message },
      });
    }
    throw err;
  }
}

async function handleDeleteConversation(
  id: string,
  req: Request,
  ctx: ApiContext,
): Promise<Response> {
  const conversation = getConversation(ctx.db, id);
  if (!conversation) {
    return json(404, {
      error: { code: "not_found", message: `No conversation with id "${id}"` },
    });
  }
  const project = getProject(ctx.db, conversation.project_id);
  if (!project) {
    return json(404, {
      error: {
        code: "project_not_found",
        message: `No project with id "${conversation.project_id}"`,
      },
    });
  }

  let removeWorktree = false;
  let force = false;
  if (req.method === "DELETE") {
    const body = await readJson(req);
    if (body !== null) {
      if (!isPlainObject(body)) {
        return json(400, {
          error: { code: "invalid_body", message: "Request body must be a JSON object" },
        });
      }
      removeWorktree = body.removeWorktree === true || body.remove_worktree === true;
      force = body.force === true;
    }
  }

  try {
    await ctx.sessions.stop(id);
    await deleteConversation(ctx.db, project, conversation, { removeWorktree, force });
    ctx.meta.broadcast(id, { kind: "conversation_deleted", conversation_id: id });
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof WorktreeError) {
      const status = err.code === "dirty_worktree" ? 409 : 400;
      return json(status, {
        error: { code: err.code, message: err.message },
      });
    }
    throw err;
  }
}

async function handleGetConversationMessages(id: string, ctx: ApiContext): Promise<Response> {
  const conversation = getConversation(ctx.db, id);
  if (!conversation) {
    return json(404, {
      error: { code: "not_found", message: `No conversation with id "${id}"` },
    });
  }
  if (!conversation.session_id) {
    return json(200, { messages: [] });
  }
  const messages = await readTranscript({
    cwd: conversation.worktree_path,
    sessionId: conversation.session_id,
  });
  return json(200, { messages });
}

async function handleSendConversationMessage(
  id: string,
  req: Request,
  ctx: ApiContext,
): Promise<Response> {
  const body = await readJson(req);
  if (!isPlainObject(body) || typeof body.text !== "string") {
    return json(400, {
      error: { code: "invalid_body", message: "Body must be { text: string }" },
    });
  }
  const conversation = getConversation(ctx.db, id);
  if (!conversation) {
    return json(404, {
      error: { code: "not_found", message: `No conversation with id "${id}"` },
    });
  }
  try {
    await ctx.sessions.send(id, body.text);
    return json(202, { ok: true });
  } catch (err) {
    if (err instanceof SessionStartError) {
      const status = err.code === "worktree_in_use" ? 409 : 400;
      return json(status, { error: { code: err.code, message: err.message } });
    }
    throw err;
  }
}

export async function handleApi(req: Request, ctx: ApiContext): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/")) return null;

  if (slashCommandsUrl(url.pathname)) {
    if (req.method === "GET") return json(200, { commands: listServerHandledCommands() });
    return json(405, {
      error: {
        code: "method_not_allowed",
        message: `Method ${req.method} not allowed on ${url.pathname}`,
      },
    });
  }

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

  const conversationsProjectId = projectConversationsMatch(url.pathname);
  if (conversationsProjectId) {
    if (req.method === "GET") return handleListProjectConversations(conversationsProjectId, ctx);
    if (req.method === "POST")
      return handleCreateProjectConversation(conversationsProjectId, req, ctx);
    return json(405, {
      error: {
        code: "method_not_allowed",
        message: `Method ${req.method} not allowed on ${url.pathname}`,
      },
    });
  }

  const conversationMessagesId = conversationMessagesMatch(url.pathname);
  if (conversationMessagesId) {
    if (req.method === "GET") return handleGetConversationMessages(conversationMessagesId, ctx);
    if (req.method === "POST")
      return handleSendConversationMessage(conversationMessagesId, req, ctx);
    return json(405, {
      error: {
        code: "method_not_allowed",
        message: `Method ${req.method} not allowed on ${url.pathname}`,
      },
    });
  }

  const conversationId = conversationByIdMatch(url.pathname);
  if (conversationId) {
    if (req.method === "GET") return handleGetConversation(conversationId, ctx);
    if (req.method === "PATCH") return handleUpdateConversation(conversationId, req, ctx);
    if (req.method === "DELETE") return handleDeleteConversation(conversationId, req, ctx);
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
