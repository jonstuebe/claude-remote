export type Project = {
  id: string;
  name: string;
  repo_path: string;
  default_branch: string;
  worktree_root: string;
  permissions_mode: "bypassPermissions" | "acceptEdits";
  current_branch?: string | null;
  dirty?: boolean;
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

export type ImportableWorktree = {
  path: string;
  branch: string | null;
  session_id: string | null;
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

export async function listProjectConversationState(
  projectId: string,
): Promise<{ conversations: Conversation[]; importable_worktrees: ImportableWorktree[] }> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/conversations`);
  return unwrap<{ conversations: Conversation[]; importable_worktrees: ImportableWorktree[] }>(res);
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

export async function importConversation(
  projectId: string,
  worktreePath: string,
): Promise<Conversation> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/conversations/import`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worktree_path: worktreePath }),
    },
  );
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
  | {
      kind: "permission_request";
      id: string;
      tool: string;
      input: Record<string, unknown>;
      summary: string;
      riskLevel: "medium" | "high";
      input_locked: boolean;
    }
  | {
      kind: "permission_decision";
      id: string;
      decision: "allow" | "deny" | "allow_for_session";
      input_locked: boolean;
    }
  | { kind: "system"; uuid: string; ts: string; subtype: string; text: string };

export async function getConversation(id: string): Promise<Conversation> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
  return unwrap<Conversation>(res);
}

export type UpdateConversationInput = {
  title?: string;
  color?: string | null;
  archived?: boolean;
};

export async function updateConversation(
  id: string,
  input: UpdateConversationInput,
): Promise<Conversation> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap<Conversation>(res);
}

export type DeleteConversationOptions = {
  removeWorktree?: boolean;
  force?: boolean;
};

export async function deleteConversation(
  id: string,
  options: DeleteConversationOptions = {},
): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options),
  });
  await unwrap<void>(res);
}

export async function getConversationMessages(id: string): Promise<TranscriptMessage[]> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}/messages`);
  const data = await unwrap<{ messages: TranscriptMessage[] }>(res);
  return data.messages;
}

export async function sendConversationMessage(
  id: string,
  text: string,
  takeover = false,
): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, takeover }),
  });
  await unwrap<{ ok: true }>(res);
}

export async function openConversationInTerminal(id: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}/open-terminal`, {
    method: "POST",
  });
  await unwrap<{ ok: true }>(res);
}

export type SlashCommandKind = "tui-replaced" | "server-handled" | "dispatched";

export type SlashCommand = {
  name: string;
  kind: SlashCommandKind;
  description: string;
  argumentHint: string;
  source: string;
};

export async function listSlashCommands(projectId: string, query = ""): Promise<SlashCommand[]> {
  const params = new URLSearchParams({ project_id: projectId });
  if (query) params.set("q", query);
  const res = await fetch(`/api/slash-commands?${params}`);
  const data = await unwrap<{ commands: SlashCommand[] }>(res);
  return data.commands;
}

export type PluginInfo = {
  name: string;
  path: string;
  enabled: boolean;
};

export async function listPlugins(projectId: string): Promise<PluginInfo[]> {
  const params = new URLSearchParams({ project_id: projectId });
  const res = await fetch(`/api/plugins?${params}`);
  const data = await unwrap<{ plugins: PluginInfo[] }>(res);
  return data.plugins;
}

export async function installPlugin(marketplaceId: string): Promise<string> {
  const res = await fetch("/api/plugins/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ marketplace_id: marketplaceId }),
  });
  const data = await unwrap<{ output: string }>(res);
  return data.output;
}

export async function uninstallPlugin(name: string): Promise<string> {
  const res = await fetch(`/api/plugins/${encodeURIComponent(name)}`, { method: "DELETE" });
  const data = await unwrap<{ output: string }>(res);
  return data.output;
}

export async function setProjectPluginEnabled(
  projectId: string,
  pluginName: string,
  enabled: boolean,
): Promise<void> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/plugins/${encodeURIComponent(pluginName)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
  );
  await unwrap<{ ok: true }>(res);
}

export type SettingsJson = Record<string, unknown>;

export type UserSettings = SettingsJson & {
  keep_awake?: boolean;
  terminal_command_template?: string;
};

export async function getSettings(
  projectId: string,
): Promise<{ user: UserSettings; project: SettingsJson }> {
  const params = new URLSearchParams({ project_id: projectId });
  const res = await fetch(`/api/settings?${params}`);
  return unwrap<{ user: UserSettings; project: SettingsJson }>(res);
}

export async function updateUserSettings(input: Partial<UserSettings>): Promise<UserSettings> {
  const res = await fetch("/api/settings/user", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await unwrap<{ user: UserSettings }>(res);
  return data.user;
}

export async function updateProjectSettings(
  projectId: string,
  settings: SettingsJson,
): Promise<SettingsJson> {
  const params = new URLSearchParams({ project_id: projectId });
  const res = await fetch(`/api/settings/project?${params}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings),
  });
  const data = await unwrap<{ project: SettingsJson }>(res);
  return data.project;
}

export type AgentInfo = {
  name: string;
  description: string;
  model: string | null;
  tools: string[];
  source: "project" | "user";
  path: string;
};

export async function listAgents(projectId: string): Promise<AgentInfo[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/agents`);
  const data = await unwrap<{ agents: AgentInfo[] }>(res);
  return data.agents;
}
