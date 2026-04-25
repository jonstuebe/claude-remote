# claude-remote

A self-hosted server that wraps the Claude Agent SDK and serves a mobile-first web client from the same process. It lets you drive Claude Code on your laptop from your phone, organized around projects and git worktrees, with native UI for slash commands, plugins, agents, and permission requests.

> Status: early development. See [PRD #1](https://github.com/jonstuebe/claude-remote/issues/1) for the full spec.

## Why

The official Claude app's Claude Code surface only attaches to a single working tree per project, and most third-party apps don't expose slash commands, custom `.claude/commands`, plugins, or agent definitions. claude-remote runs on your own machine and exposes everything Claude Code can do, accessed from any phone or browser on your network (Tailscale recommended; LAN as fallback).

## Highlights

- **Worktree-native conversations.** Each conversation is either attached to the project's main checkout or a dedicated git worktree the server manages. Spawn parallel work streams without collisions.
- **Mobile-first web client.** Browse projects, open conversations, send messages, see streaming responses and tool calls — built for the phone, accessible from any browser.
- **Auto permissions.** Defaults to `bypassPermissions`. Truly risky operations surface inline in the chat with Allow / Deny / Allow-for-session buttons.
- **Native slash commands, plugins, agents.** Built-in, `.claude/commands/`, user-level, and plugin commands all surface in autocomplete. Plugin manager, settings, and agent browser have dedicated screens.
- **Multi-device sync.** Send from your phone, see it on your laptop. WebSocket fan-out keeps every connected client of a conversation in sync.
- **Desktop handoff.** Open any conversation in your terminal on the host machine with one tap. The server releases its SDK process so the JSONL transcript stays consistent.
- **Resilient to sleep, drops, and reconnects.** A single-session ledger guarantees one SDK process per conversation. Client disconnects don't kill in-flight Claude turns.

## Architecture

A single Bun process serves the TanStack Start web app and the server-side API: HTTP routes for CRUD, WebSocket for streaming chat events and bidirectional permission requests.

- **SQLite** caches the project registry and conversation metadata (titles, colors, archive state). Git, the filesystem, and `~/.claude/projects/` are the sources of truth — every cached row is either user intent or a derivable cache.
- **One Claude Agent SDK process per active conversation.** Multi-device clients multiplex via WebSocket fan-out.
- **Transcripts are read on demand** from `~/.claude/projects/<sanitized-path>/<session_id>.jsonl`. Messages are not stored in SQLite.
- **Worktrees** are placed by default in `<repo_parent>/.worktrees/<repo-name>/` as siblings to the main checkout.

Core modules: Worktree Manager, Reconciler, Session Manager, Permission Broker, Transcript Reader, Slash Command Registry, plus shallow modules for Project Registry, Conversation Store, Plugin Manager, Settings Manager, Agent Browser, Terminal Launcher, and the WebSocket transport.

## Stack

- Runtime: **Bun**
- Frontend: **TanStack Start** (React, file-based routing, server functions)
- Styling: **Tailwind v4** + **shadcn/base-ui** (Luma) + Lucide icons
- Validation: **Zod**
- Lint/format: **oxlint** + **oxfmt**
- Type-checking: **tsgo**
- Tests: **Vitest**
- Build: Vite (dev), Bun (prod)
- Default port: **2633**

## Setup

```bash
bun install
bun run db:migrate
bun run dev
```

## Scripts

| Script               | Description                                 |
| -------------------- | ------------------------------------------- |
| `bun run dev`        | Run the dev server (Vite + TanStack Start). |
| `bun run build`      | Build for production.                       |
| `bun run start`      | Run the production server.                  |
| `bun run db:migrate` | Apply SQL migrations.                       |
| `bun run test`       | Run Vitest.                                 |
| `bun run test:watch` | Run Vitest in watch mode.                   |
| `bun run lint`       | Lint with oxlint.                           |
| `bun run format`     | Format with oxfmt.                          |
| `bun run typecheck`  | Type-check with tsgo.                       |

## Network access

There is no in-app auth in v1. Access control is delegated to the network layer:

- **Recommended:** run the server on a Tailscale network so your phone can reach it from anywhere.
- **Fallback:** local Wi-Fi only.

## Out of scope (v1)

Native mobile apps, in-app auth, multi-user support, cloud-hosted version, Linux power-management for `keep_awake`, interoperability with the official Anthropic Remote Control protocol, and migration tooling for existing tmux/screen setups. See [PRD #1](https://github.com/jonstuebe/claude-remote/issues/1) for the full list.
