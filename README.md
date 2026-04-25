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
bun run db:migrate    # optional — `dev` and `start` migrate automatically
bun run dev
```

The dev server prints its URL on stdout; the production server is started with `bun run build && bun run start`.

## Configuration

All configuration is via environment variables. There is no config file in v1.

| Variable                 | Default                | Description                                                       |
| ------------------------ | ---------------------- | ----------------------------------------------------------------- |
| `PORT`                   | `2633`                 | Port the HTTP server listens on (web in dev; everything in prod). |
| `API_PORT`               | `2634`                 | Dev-only API port that Vite proxies `/api/*` to.                  |
| `HOST`                   | `127.0.0.1`            | Bind address. Set to `0.0.0.0` to expose on the LAN/Tailscale.    |
| `CLAUDE_REMOTE_DATA_DIR` | `~/.claude-remote`     | Directory for SQLite cache and any runtime state.                 |
| `CLAUDE_REMOTE_DB_PATH`  | `<DATA_DIR>/db.sqlite` | Override the SQLite file location directly.                       |

## Scripts

| Script               | Description                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `bun run dev`        | Migrate, then run Vite (web) + a Bun API process side-by-side; Vite proxies `/api/*` to the API. |
| `bun run dev:api`    | Run only the Bun API process (`server/dev-api.ts`) with `--hot`.                                 |
| `bun run dev:web`    | Run only `vite dev` for the front-end.                                                           |
| `bun run build`      | Build the client + SSR bundles for production.                                                   |
| `bun run start`      | Run the production server (single `Bun.serve` over the built output, including the API).         |
| `bun run db:migrate` | Apply pending SQL migrations.                                                                    |
| `bun run test`       | Run Vitest.                                                                                      |
| `bun run test:watch` | Run Vitest in watch mode.                                                                        |
| `bun run lint`       | Lint with oxlint.                                                                                |
| `bun run format`     | Format with oxfmt.                                                                               |
| `bun run typecheck`  | Type-check with tsgo.                                                                            |

## Database & migrations

SQLite, opened via `bun:sqlite`. Schema evolves through numbered SQL files in `server/db/migrations/` (`001_init.sql`, `002_*.sql`, ...). The Migration Runner:

- Applies pending migrations in version order on every server start (and via `bun run db:migrate`).
- Tracks applied versions in a `schema_version` table, so re-runs are idempotent.
- Wraps each migration in a transaction — partial application rolls back automatically.
- Fails loudly on malformed filenames, duplicate version numbers, empty files, or invalid SQL, with an error that names the offending file.

The runner has unit tests in `tests/migrator.test.ts`. Run them with `bun run test`.

## HTTP API

| Method   | Path                | Description                                                                                      |
| -------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `GET`    | `/api/projects`     | List all registered projects.                                                                    |
| `POST`   | `/api/projects`     | Register `{ name, repo_path }`. Validates the path is a git repo and detects the default branch. |
| `GET`    | `/api/projects/:id` | Get a single project.                                                                            |
| `DELETE` | `/api/projects/:id` | Remove the registry row. **Does not** touch the filesystem at `repo_path`.                       |

Validation errors return `400` (`409` for re-registering the same path) with `{ error: { code, field?, message } }`.

## A note on Vite

`CLAUDE.md` in this repo says "don't use Vite, use `Bun.serve()`." This project is the documented exception: TanStack Start is built on Vite, and we take Vite as a build tool to get TanStack Start's framework value (file-based routing, server functions, type-safe data loading, SSR). At runtime everything still runs on Bun:

- **Dev:** `bun run dev` launches two Bun processes: one runs `vite dev` for the web (HMR, TanStack Start) and one runs `server/dev-api.ts` (`Bun.serve` + `bun:sqlite`). Vite proxies `/api/*` to the API process so the front-end can call the real API in development. The split exists because Vite itself runs under Node, which can't import `bun:sqlite`.
- **Prod:** `vite build` produces a `{ fetch }`-style SSR bundle in `dist/server/server.js` plus static assets in `dist/client/`. The `bun run start` entry (`index.ts`) wraps that bundle in a single `Bun.serve()` that owns the API, the SQLite cache, static assets, and SSR — and (in later slices) the WebSocket transport and Claude Agent SDK processes.

This exception applies only to TanStack Start. New runtime code in this repo continues to use `Bun.serve()`, `bun:sqlite`, `Bun.file`, etc., per `CLAUDE.md`.

## Network access

There is no in-app auth in v1. Access control is delegated to the network layer:

- **Recommended:** run the server on a Tailscale network so your phone can reach it from anywhere.
- **Fallback:** local Wi-Fi only.

## Out of scope (v1)

Native mobile apps, in-app auth, multi-user support, cloud-hosted version, Linux power-management for `keep_awake`, interoperability with the official Anthropic Remote Control protocol, and migration tooling for existing tmux/screen setups. See [PRD #1](https://github.com/jonstuebe/claude-remote/issues/1) for the full list.
