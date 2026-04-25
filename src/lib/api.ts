export type Project = {
  id: string;
  name: string;
  repo_path: string;
  default_branch: string;
  worktree_root: string;
  permissions_mode: "bypassPermissions" | "acceptEdits";
  created_at: string;
};

export type RegisterProjectInput = {
  name: string;
  repo_path: string;
};

export type ConversationStatus = "active" | "orphaned" | "archived";

export type Conversation = {
  id: string;
  project_id: string;
  worktree_path: string;
  branch: string;
  session_id: string | null;
  title: string;
  color: string | null;
  is_default: boolean;
  status: ConversationStatus;
  created_at: string;
  last_active_at: string;
};

export type ApiError = {
  code: string;
  field?: string;
  message: string;
};

export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiError;
  constructor(status: number, body: ApiError) {
    super(body.message);
    this.name = "ApiRequestError";
    this.status = status;
    this.body = body;
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  let body: ApiError;
  try {
    const json = (await res.json()) as { error?: ApiError };
    body = json.error ?? { code: "unknown", message: `Request failed (${res.status})` };
  } catch {
    body = { code: "unknown", message: `Request failed (${res.status})` };
  }
  throw new ApiRequestError(res.status, body);
}

export async function listProjects(): Promise<Project[]> {
  const res = await fetch("/api/projects");
  const data = await unwrap<{ projects: Project[] }>(res);
  return data.projects;
}

export async function registerProject(input: RegisterProjectInput): Promise<Project> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<Project>(res);
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
  await unwrap<void>(res);
}

export async function getProject(id: string): Promise<Project> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
  return unwrap<Project>(res);
}

export async function listConversations(projectId: string): Promise<Conversation[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/conversations`);
  const data = await unwrap<{ conversations: Conversation[] }>(res);
  return data.conversations;
}

export type CreateConversationInput =
  | { mode: "main" }
  | { mode: "new-worktree"; branch: string; base_branch?: string }
  | { mode: "existing-branch"; branch: string };

export async function createConversation(
  projectId: string,
  input: CreateConversationInput,
): Promise<Conversation> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<Conversation>(res);
}

export type AssistantBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export type TranscriptMessage =
  | { kind: "user_message"; uuid: string; ts: string; text: string }
  | { kind: "assistant_message"; uuid: string; ts: string; blocks: AssistantBlock[] }
  | {
      kind: "tool_result";
      uuid: string;
      ts: string;
      tool_use_id: string;
      content: string;
      is_error: boolean;
    }
  | { kind: "system"; uuid: string; ts: string; subtype: string; text: string };

export async function getConversation(id: string): Promise<Conversation> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
  return unwrap<Conversation>(res);
}

export async function getConversationMessages(id: string): Promise<TranscriptMessage[]> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}/messages`);
  const data = await unwrap<{ messages: TranscriptMessage[] }>(res);
  return data.messages;
}

export async function sendConversationMessage(id: string, text: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  await unwrap<{ ok: true }>(res);
}
