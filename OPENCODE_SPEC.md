# OpenCode Implementation Map

Source root: `/Users/johnsuh/opencode`

Purpose: map important OpenCode runtime features to implementation files. Paths below are relative to source root.

## Runtime Shape

OpenCode is TypeScript/Bun application with Effect services behind CLI, TUI, HTTP server, web app, desktop app, SDK, and ACP adapters.

Core flow:

1. npm binary wrapper resolves platform binary or `OPENCODE_BIN_PATH`.
2. CLI parses command with `yargs`.
3. Command enters project instance context through `bootstrap` / `Instance.provide`.
4. Local commands either start HTTP server or call `Server.Default().app.fetch` directly through SDK client.
5. HTTP route validates input and runs Effect service through request tracing helpers.
6. `SessionPrompt.prompt` creates user message, resolves files/resources/agents, persists parts, then enters loop.
7. `SessionPrompt.run` selects agent/model, builds system/context/messages/tools, and creates assistant message.
8. `SessionProcessor` streams AI SDK events, persists message parts, executes tools, tracks snapshots, publishes bus/sync events, and requests compaction when context overflows.
9. SQLite tables store sessions/messages/parts/todos/sync events. Sync projectors translate event writes into tables and bus events.

Runtime centers:

- `AppRuntime`: singleton Effect runtime containing all application services.
- `Instance`: project/worktree/directory context facade around `InstanceStore`.
- `Server`: Hono or experimental Effect HTTP API router.
- `SessionPrompt`: high-level session command/prompt/shell loop.
- `SessionProcessor`: turn-scoped stream and tool-call processor.
- `LLM`: AI SDK `streamText` model client adapter.
- `ToolRegistry`: built-in, plugin, and MCP tool assembly.
- `Bus`: instance event pub/sub plus global event forwarding.
- `SyncEvent`: transactional event log/projector system.

## Entrypoints

- npm binary wrapper: `packages/opencode/bin/opencode`
- CLI dispatch: `packages/opencode/src/index.ts`
- CLI bootstrap: `packages/opencode/src/cli/bootstrap.ts`
- Command helper: `packages/opencode/src/cli/cmd/cmd.ts`
- Interactive TUI command: `packages/opencode/src/cli/cmd/tui/thread.ts`
- TUI app root: `packages/opencode/src/cli/cmd/tui/app.tsx`
- Non-interactive run command: `packages/opencode/src/cli/cmd/run.ts`
- Headless server command: `packages/opencode/src/cli/cmd/serve.ts`
- ACP server command: `packages/opencode/src/cli/cmd/acp.ts`
- MCP management command: `packages/opencode/src/cli/cmd/mcp.ts`
- Web command: `packages/opencode/src/cli/cmd/web.ts`
- Desktop app main process: `packages/desktop-electron/src/main/index.ts`
- Desktop server launcher: `packages/desktop-electron/src/main/server.ts`
- Web app root: `packages/app/src/app.tsx`
- Web app entry: `packages/app/src/entry.tsx`
- SDK v2 client: `packages/sdk/js/src/v2/client.ts`
- SDK v2 server helper: `packages/sdk/js/src/v2/server.ts`

## Protocol

OpenCode public protocol is HTTP API plus SSE event stream generated from Hono route schemas and Effect/Zod schemas.

- Route root: `packages/opencode/src/server/server.ts`
- Instance routes: `packages/opencode/src/server/routes/instance/index.ts`
- Session routes: `packages/opencode/src/server/routes/instance/session.ts`
- Event stream route: `packages/opencode/src/server/routes/instance/event.ts`
- Global/control routes: `packages/opencode/src/server/routes/global.ts`, `packages/opencode/src/server/routes/control/index.ts`
- OpenAPI generation: `packages/opencode/src/server/server.ts`
- Generated SDK v2 types/client: `packages/sdk/js/src/v2/gen/types.gen.ts`, `packages/sdk/js/src/v2/gen/sdk.gen.ts`, `packages/sdk/js/src/v2/gen/client/client.gen.ts`
- SDK v2 client wrapper: `packages/sdk/js/src/v2/client.ts`
- Effect HTTP API surface: `packages/opencode/src/server/routes/instance/httpapi/api.ts`
- Effect HTTP API groups: `packages/opencode/src/server/routes/instance/httpapi/groups/*.ts`
- Effect HTTP API handlers: `packages/opencode/src/server/routes/instance/httpapi/handlers/*.ts`

Important protocol objects:

- `Session.Info`: session metadata.
- `MessageV2.Info`: user/assistant message metadata.
- `MessageV2.Part`: text, reasoning, tool, file, patch, step, subtask, and compaction parts.
- `SessionPrompt.PromptInput`: user prompt API body.
- `SessionPrompt.CommandInput`: slash command API body.
- `SessionPrompt.ShellInput`: user shell-command API body.
- `Permission.Request` / `Permission.Reply`: permission round trip.
- `BusEvent` payloads: SSE event shapes.
- `SyncEvent` payloads: transactional state-change events.

## Server Runtime

- Server selector: `packages/opencode/src/server/backend.ts`
- Server factory/listener: `packages/opencode/src/server/server.ts`
- Bun adapter: `packages/opencode/src/server/adapter.bun.ts`
- Node adapter: `packages/opencode/src/server/adapter.node.ts`
- Adapter contract: `packages/opencode/src/server/adapter.ts`
- Middleware: `packages/opencode/src/server/middleware.ts`
- Workspace routing: `packages/opencode/src/server/workspace.ts`
- Request trace helpers: `packages/opencode/src/server/routes/instance/trace.ts`
- Route projectors init: `packages/opencode/src/server/projectors.ts`
- CORS config: `packages/opencode/src/server/cors.ts`
- Auth middleware: `packages/opencode/src/server/middleware.ts`
- mDNS publishing: `packages/opencode/src/server/mdns.ts`

Default backend is Hono. `OPENCODE_EXPERIMENTAL_HTTPAPI` selects Effect HTTP API. `Server.Default()` provides in-process fetch path used by CLI run mode and plugins.

## Effect Runtime

- App layer/runtime: `packages/opencode/src/effect/app-runtime.ts`
- Runtime attachment: `packages/opencode/src/effect/run-service.ts`
- Instance references: `packages/opencode/src/effect/instance-ref.ts`
- Instance state cache: `packages/opencode/src/effect/instance-state.ts`
- Instance registry: `packages/opencode/src/effect/instance-registry.ts`
- Service helper: `packages/opencode/src/effect/service-use.ts`
- Bridge from Effect to callbacks/promises: `packages/opencode/src/effect/bridge.ts`
- Bootstrap runtime: `packages/opencode/src/effect/bootstrap-runtime.ts`

`AppLayer` merges filesystem, bus, auth, config, git, storage, snapshot, plugin, provider, agent, skill, permission, session, MCP, LSP, tool, project, workspace, pty, share, and sync services. `attach` restores current `Instance` and workspace refs into Effect execution.

## Project And Instance Context

- Instance facade: `packages/opencode/src/project/instance.ts`
- Instance context shape: `packages/opencode/src/project/instance-context.ts`
- Instance store: `packages/opencode/src/project/instance-store.ts`
- Project service: `packages/opencode/src/project/project.ts`
- Project schema/table: `packages/opencode/src/project/schema.ts`, `packages/opencode/src/project/project.sql.ts`
- VCS service: `packages/opencode/src/project/vcs.ts`
- Worktree service: `packages/opencode/src/worktree/index.ts`
- Workspace service: `packages/opencode/src/control-plane/workspace.ts`
- Workspace context: `packages/opencode/src/control-plane/workspace-context.ts`

`Instance.provide` loads project/worktree/directory context and binds async-local context for APIs that still read `Instance.current`. Effect-native code reads `InstanceRef`.

## Session Runtime

- Session service and schemas: `packages/opencode/src/session/session.ts`
- Session IDs: `packages/opencode/src/session/schema.ts`
- Prompt/loop service: `packages/opencode/src/session/prompt.ts`
- Processor: `packages/opencode/src/session/processor.ts`
- LLM adapter: `packages/opencode/src/session/llm.ts`
- Message model: `packages/opencode/src/session/message-v2.ts`
- Run-state/cancellation: `packages/opencode/src/session/run-state.ts`
- Status service: `packages/opencode/src/session/status.ts`
- Compaction: `packages/opencode/src/session/compaction.ts`
- Overflow detection: `packages/opencode/src/session/overflow.ts`
- Retry policy: `packages/opencode/src/session/retry.ts`
- Summary/diff service: `packages/opencode/src/session/summary.ts`
- Revert service: `packages/opencode/src/session/revert.ts`
- Todo service: `packages/opencode/src/session/todo.ts`
- Instruction loading: `packages/opencode/src/session/instruction.ts`
- System prompt service: `packages/opencode/src/session/system.ts`
- Session SQL tables: `packages/opencode/src/session/session.sql.ts`
- Session projectors: `packages/opencode/src/session/projectors.ts`

Loop behavior:

1. `prompt` writes user message and parts, updates session permissions from tool toggles, then calls `loop`.
2. `runLoop` reads compacted message history, finds latest user/assistant, resolves pending subtask or compaction parts, and exits when assistant has finished.
3. First loop step can generate title and summarize prior context.
4. Agent/model determine tool set and prompt shape.
5. `SessionProcessor.create` captures initial snapshot and returns handle for stream processing.
6. `handle.process` consumes `LLM.stream` and writes reasoning/text/tool/step/patch parts.
7. Tool calls continue loop until no pending tool results remain or run stops.

## Persistence

Primary persistence is SQLite through Drizzle plus small JSON stores for auth/config/older storage migration.

- SQLite client and migrations: `packages/opencode/src/storage/db.ts`
- Bun SQLite binding: `packages/opencode/src/storage/db.bun.ts`
- Node SQLite binding: `packages/opencode/src/storage/db.node.ts`
- Schema helpers: `packages/opencode/src/storage/schema.sql.ts`
- JSON storage service and migrations: `packages/opencode/src/storage/storage.ts`
- JSON-to-SQL migration: `packages/opencode/src/storage/json-migration.ts`
- Session/message/part/todo tables: `packages/opencode/src/session/session.sql.ts`
- Project table: `packages/opencode/src/project/project.sql.ts`
- Account table: `packages/opencode/src/account/account.sql.ts`
- Share table: `packages/opencode/src/share/share.sql.ts`
- Sync event tables: `packages/opencode/src/sync/event.sql.ts`
- Database migrations: `packages/opencode/migration/*/migration.sql`
- Global paths: `packages/core/src/global.ts`
- Auth file store: `packages/opencode/src/auth/index.ts`

Durable files:

```text
$XDG_DATA_HOME/opencode/opencode.db
$XDG_DATA_HOME/opencode/auth.json
$XDG_DATA_HOME/opencode/log/
$XDG_CONFIG_HOME/opencode/opencode.jsonc
$XDG_CONFIG_HOME/opencode/opencode.json
$XDG_STATE_HOME/opencode/model.json
$XDG_CACHE_HOME/opencode/models.json
```

`Database.Path` honors `OPENCODE_DB`. Nonstandard installation channels can use channel-specific database filenames unless channel DB is disabled.

## Sync And Events

- Bus service: `packages/opencode/src/bus/index.ts`
- Bus event registry: `packages/opencode/src/bus/bus-event.ts`
- Global bus bridge: `packages/opencode/src/bus/global.ts`
- SSE route: `packages/opencode/src/server/routes/instance/event.ts`
- Sync event service: `packages/opencode/src/sync/index.ts`
- Sync schema: `packages/opencode/src/sync/schema.ts`
- Sync SQL tables: `packages/opencode/src/sync/event.sql.ts`
- Projector init: `packages/opencode/src/server/projectors.ts`
- Session projectors: `packages/opencode/src/session/projectors.ts`

Important events:

- `session.created`, `session.updated`, `session.deleted`
- `message.updated`, `message.removed`, `message.part.updated`, `message.part.removed`
- `message.part.delta`
- `session.status`, `session.error`, `session.diff`, `session.compacted`
- `permission.asked`, `permission.replied`
- `question.asked`, `question.replied`, `question.rejected`
- `todo.updated`
- `pty.created`, `pty.updated`, `pty.exited`, `pty.deleted`
- `mcp.tools.changed`, `mcp.browser.open.failed`
- `server.connected`, `server.instance.disposed`, `global.disposed`

`SyncEvent.run` writes event and projected rows in immediate SQLite transaction. Bus publishing happens after DB effect. SSE emits JSON payloads through `/event` plus heartbeat.

## Model Client

- Provider service: `packages/opencode/src/provider/provider.ts`
- Provider model metadata fetch/cache: `packages/opencode/src/provider/models.ts`
- Provider transform/options: `packages/opencode/src/provider/transform.ts`
- Provider schemas: `packages/opencode/src/provider/schema.ts`
- Provider auth flow: `packages/opencode/src/provider/auth.ts`
- Provider config schema: `packages/opencode/src/config/provider.ts`
- LLM stream adapter: `packages/opencode/src/session/llm.ts`

Important behavior:

- Model metadata comes from `models.dev` or configured `OPENCODE_MODELS_URL` / `OPENCODE_MODELS_PATH`.
- Provider state merges models.dev, config providers, env keys, stored auth, plugin auth/provider hooks, and built-in provider customizations.
- Bundled AI SDK providers are imported directly; unbundled providers are installed via `Npm.add`.
- `Provider.getLanguage` caches language models by `providerID/modelID`.
- `LLM.run` calls AI SDK `streamText`, wraps provider model with `transformParams`, injects OpenCode headers, telemetry, tool choice, model options, and provider-specific options.
- `experimental_repairToolCall` lowercases tool names when possible or routes invalid calls to `invalid`.
- `resolveTools` disables tools by permission and per-message tool toggles before sending active tools to AI SDK.

## Prompt And Context

- Main prompt loop: `packages/opencode/src/session/prompt.ts`
- System prompt selector: `packages/opencode/src/session/system.ts`
- Prompt text files: `packages/opencode/src/session/prompt/*.txt`
- Provider base prompts: `packages/opencode/src/session/prompt/default.txt`, `anthropic.txt`, `gpt.txt`, `gemini.txt`, `codex.txt`, `trinity.txt`, `kimi.txt`, `beast.txt`
- Agent definitions and prompt loading: `packages/opencode/src/agent/agent.ts`
- Agent generation prompt: `packages/opencode/src/agent/generate.txt`
- Command templates: `packages/opencode/src/command/index.ts`, `packages/opencode/src/command/template/*`
- Config markdown parser: `packages/opencode/src/config/markdown.ts`
- Skill discovery/loading: `packages/opencode/src/skill/index.ts`, `packages/opencode/src/skill/discovery.ts`
- Message to model conversion: `packages/opencode/src/session/message-v2.ts`

Prompt content combines:

- Provider-specific base prompt or agent prompt.
- Environment context from `SystemPrompt.environment`.
- Runtime instructions from `Instruction.Service`.
- Skill list from `SystemPrompt.skills`.
- User message `system` field.
- Synthetic plan/build reminders.
- File, directory, data URL, MCP resource, agent, subtask, and command-expanded prompt parts.
- Compacted message history from `MessageV2.filterCompactedEffect`.
- Structured-output instruction and `StructuredOutput` tool when JSON schema format is requested.

## Agents

- Agent service: `packages/opencode/src/agent/agent.ts`
- Agent config schema: `packages/opencode/src/config/agent.ts`
- Agent generation command: `packages/opencode/src/cli/cmd/agent.ts`
- Agent prompt assets: `packages/opencode/src/agent/prompt/*`

Built-in agents:

- `build`: primary default agent with normal tool access.
- `plan`: primary planning agent with edit restrictions and plan-file workflow.
- `general`: subagent for broad multi-step work.
- `explore`: subagent for fast codebase exploration.
- `compaction`: hidden primary summarization agent.
- `title`: hidden primary title-generation agent.
- `summary`: hidden primary summary agent.

Config can add, modify, hide, disable, or assign models/variants/prompts/options/permissions to agents.

## Tool System

- Tool definition contract: `packages/opencode/src/tool/tool.ts`
- Tool registry: `packages/opencode/src/tool/registry.ts`
- Tool schemas: `packages/opencode/src/tool/schema.ts`
- Tool truncation: `packages/opencode/src/tool/truncate.ts`
- Tool truncation directory: `packages/opencode/src/tool/truncation-dir.ts`
- Permission service: `packages/opencode/src/permission/index.ts`
- Permission evaluation: `packages/opencode/src/permission/evaluate.ts`
- Permission schemas: `packages/opencode/src/permission/schema.ts`

Tool assembly:

1. Built-in `Tool.Info` values initialize through `Tool.init`.
2. Config directories contribute `{tool,tools}/*.{js,ts}` modules.
3. Plugins contribute `hook.tool`.
4. MCP connected servers contribute sanitized dynamic tools.
5. Model/provider/agent filters choose visible tools.
6. Plugin `tool.definition` hook can mutate description/schema before model exposure.

Built-in tools:

- `bash`: `packages/opencode/src/tool/bash.ts`, `packages/opencode/src/tool/bash.txt`
- `read`: `packages/opencode/src/tool/read.ts`, `packages/opencode/src/tool/read.txt`
- `glob`: `packages/opencode/src/tool/glob.ts`, `packages/opencode/src/tool/glob.txt`
- `grep`: `packages/opencode/src/tool/grep.ts`, `packages/opencode/src/tool/grep.txt`
- `edit`: `packages/opencode/src/tool/edit.ts`, `packages/opencode/src/tool/edit.txt`
- `write`: `packages/opencode/src/tool/write.ts`, `packages/opencode/src/tool/write.txt`
- `apply_patch`: `packages/opencode/src/tool/apply_patch.ts`, `packages/opencode/src/tool/apply_patch.txt`
- `task`: `packages/opencode/src/tool/task.ts`, `packages/opencode/src/tool/task.txt`
- `todowrite`: `packages/opencode/src/tool/todo.ts`, `packages/opencode/src/tool/todowrite.txt`
- `webfetch`: `packages/opencode/src/tool/webfetch.ts`, `packages/opencode/src/tool/webfetch.txt`
- `websearch`: `packages/opencode/src/tool/websearch.ts`, `packages/opencode/src/tool/websearch.txt`
- `skill`: `packages/opencode/src/tool/skill.ts`, `packages/opencode/src/tool/skill.txt`
- `question`: `packages/opencode/src/tool/question.ts`, `packages/opencode/src/tool/question.txt`
- `plan_exit`: `packages/opencode/src/tool/plan.ts`, `packages/opencode/src/tool/plan-exit.txt`
- `lsp`: `packages/opencode/src/tool/lsp.ts`, `packages/opencode/src/tool/lsp.txt`
- `invalid`: `packages/opencode/src/tool/invalid.ts`

`apply_patch` replaces `edit/write` for GPT models selected by registry rule. `websearch` is exposed for OpenCode provider or `OPENCODE_ENABLE_EXA`. `question` is enabled for app/cli/desktop or explicit flag. `lsp` and `plan_exit` are experimental.

## Permissions

- Permission service: `packages/opencode/src/permission/index.ts`
- Permission evaluator: `packages/opencode/src/permission/evaluate.ts`
- Permission schema: `packages/opencode/src/permission/schema.ts`
- Permission route: `packages/opencode/src/server/routes/instance/permission.ts`
- Permission UI context: `packages/app/src/context/permission.tsx`
- Permission auto response helpers: `packages/app/src/context/permission-auto-respond.ts`

Permission rules are merged from agent defaults, config `permission`, per-session permissions, and prompt tool toggles. Tool context calls `ctx.ask`, which publishes `permission.asked` and waits for reply. CLI `run` auto-rejects permission prompts unless `--dangerously-skip-permissions` is set.

## MCP

- MCP service: `packages/opencode/src/mcp/index.ts`
- MCP config schema: `packages/opencode/src/config/mcp.ts`
- MCP auth store: `packages/opencode/src/mcp/auth.ts`
- MCP OAuth provider: `packages/opencode/src/mcp/oauth-provider.ts`
- MCP OAuth callback server: `packages/opencode/src/mcp/oauth-callback.ts`
- MCP route: `packages/opencode/src/server/routes/instance/mcp.ts`
- MCP CLI: `packages/opencode/src/cli/cmd/mcp.ts`

MCP supports local stdio servers and remote Streamable HTTP/SSE servers. Remote auth uses OAuth when server requires it unless disabled. Tool names are sanitized as `{server}_{tool}`. Prompts and resources are listed/read through service helpers, and prompt/file resolution can read MCP resources into message parts.

## ACP

- ACP command: `packages/opencode/src/cli/cmd/acp.ts`
- ACP agent adapter: `packages/opencode/src/acp/agent.ts`
- ACP session manager: `packages/opencode/src/acp/session.ts`
- ACP types: `packages/opencode/src/acp/types.ts`
- ACP README: `packages/opencode/src/acp/README.md`

`opencode acp` starts local OpenCode server, wraps SDK v2, then connects stdin/stdout NDJSON through `@agentclientprotocol/sdk`. ACP session manager maps ACP sessions to OpenCode sessions. Agent adapter translates permission prompts, message parts, tool calls, todos, usage, models, modes, and file writes into ACP messages.

## Commands

- Command service: `packages/opencode/src/command/index.ts`
- Command config schema: `packages/opencode/src/config/command.ts`
- Command templates: `packages/opencode/src/command/template/*`
- Command execution path: `packages/opencode/src/session/prompt.ts`
- CLI command runner: `packages/opencode/src/cli/cmd/run.ts`

Commands are prompt templates with argument interpolation, `$ARGUMENTS`, optional shell interpolation through ``!`cmd` ``, optional agent/model, and optional subtask execution. `command.execute.before` plugin hook can mutate prompt parts before execution.

## Config

- Main config schema/loading: `packages/opencode/src/config/config.ts`
- JSONC parse/schema validation: `packages/opencode/src/config/parse.ts`
- Config paths: `packages/opencode/src/config/paths.ts`
- Config variables: `packages/opencode/src/config/variable.ts`
- Provider config: `packages/opencode/src/config/provider.ts`
- Agent config: `packages/opencode/src/config/agent.ts`
- Command config: `packages/opencode/src/config/command.ts`
- Permission config: `packages/opencode/src/config/permission.ts`
- Plugin config: `packages/opencode/src/config/plugin.ts`
- MCP config: `packages/opencode/src/config/mcp.ts`
- LSP config: `packages/opencode/src/config/lsp.ts`
- Formatter config: `packages/opencode/src/config/formatter.ts`
- Skills config: `packages/opencode/src/config/skills.ts`
- Server config: `packages/opencode/src/config/server.ts`
- TUI config: `packages/opencode/src/cli/cmd/tui/config/tui.ts`

Config sources are merged in this order:

1. well-known remote configs from auth entries.
2. global config from `$XDG_CONFIG_HOME/opencode`.
3. `OPENCODE_CONFIG`.
4. project `opencode.json` / `opencode.jsonc` discovered upward to worktree.
5. `.opencode/opencode.json` / `.opencode/opencode.jsonc` directories.
6. auto-discovered commands, agents, modes, plugins under config directories.
7. `OPENCODE_CONFIG_CONTENT`.
8. active console account/org config.
9. managed config directory and macOS managed preferences.
10. env flag overlays like `OPENCODE_PERMISSION`, autocompact/prune disables.

`Config.update` writes local config and disposes current instance. `Config.updateGlobal` patches or rewrites global config and invalidates all instances when changed.

## UI

Terminal UI:

- TUI root: `packages/opencode/src/cli/cmd/tui/app.tsx`
- Home route: `packages/opencode/src/cli/cmd/tui/routes/home.tsx`
- Session route: `packages/opencode/src/cli/cmd/tui/routes/session.tsx`
- SDK context: `packages/opencode/src/cli/cmd/tui/context/sdk.tsx`
- Sync context: `packages/opencode/src/cli/cmd/tui/context/sync.tsx`
- Event context: `packages/opencode/src/cli/cmd/tui/context/event.ts`
- Keybinds: `packages/opencode/src/cli/cmd/tui/context/keybind.tsx`
- TUI config: `packages/opencode/src/cli/cmd/tui/config/tui.ts`
- TUI plugin API/runtime: `packages/opencode/src/cli/cmd/tui/plugin/api.tsx`, `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts`

Web app:

- App shell: `packages/app/src/app.tsx`
- Home page: `packages/app/src/pages/home.tsx`
- Session page: `packages/app/src/pages/session.tsx`
- Session layout: `packages/app/src/pages/session/session-layout.ts`
- Message timeline: `packages/app/src/pages/session/message-timeline.tsx`
- Prompt input: `packages/app/src/components/prompt-input.tsx`
- SDK context: `packages/app/src/context/sdk.tsx`
- Global SDK/sync: `packages/app/src/context/global-sdk.tsx`, `packages/app/src/context/global-sync.tsx`
- Session sync: `packages/app/src/context/sync.tsx`
- Server connection: `packages/app/src/context/server.tsx`
- Permission UI: `packages/app/src/context/permission.tsx`
- Terminal UI: `packages/app/src/context/terminal.tsx`, `packages/app/src/components/terminal.tsx`
- File context/tree: `packages/app/src/context/file.tsx`, `packages/app/src/components/file-tree.tsx`

Desktop:

- Electron main: `packages/desktop-electron/src/main/index.ts`
- Window management: `packages/desktop-electron/src/main/windows.ts`
- Server process: `packages/desktop-electron/src/main/server.ts`
- IPC/preload: `packages/desktop-electron/src/main/ipc.ts`, `packages/desktop-electron/src/preload/index.ts`
- Renderer: `packages/desktop-electron/src/renderer/index.tsx`

Shared UI:

- UI package root: `packages/ui/src`
- File renderer: `packages/ui/src/file`
- Markdown/marked context: `packages/ui/src/context/marked.tsx`
- Theme/font/logo components: `packages/ui/src`

## Plugin And Extension Points

- Runtime plugin service: `packages/opencode/src/plugin/index.ts`
- Plugin loader: `packages/opencode/src/plugin/loader.ts`
- Plugin shared spec utilities: `packages/opencode/src/plugin/shared.ts`
- Plugin install helpers: `packages/opencode/src/plugin/install.ts`
- Plugin metadata: `packages/opencode/src/plugin/meta.ts`
- Plugin public API types: `packages/plugin/src/index.ts`
- Plugin tool helper types: `packages/plugin/src/tool.ts`
- Plugin TUI API types: `packages/plugin/src/tui.ts`
- Plugin examples: `packages/plugin/src/example.ts`, `packages/plugin/src/example-workspace.ts`
- Built-in auth plugins: `packages/opencode/src/plugin/codex.ts`, `cloudflare.ts`, `azure.ts`, `github-copilot/*`

Server hook points:

- `event`
- `config`
- `tool`
- `auth`
- `provider`
- `chat.message`
- `chat.params`
- `chat.headers`
- `permission.ask`
- `command.execute.before`
- `tool.execute.before`
- `tool.execute.after`
- `tool.definition`
- `shell.env`
- `experimental.chat.messages.transform`
- `experimental.chat.system.transform`
- `experimental.session.compacting`
- `experimental.compaction.autocontinue`
- `experimental.text.complete`

Extension sources:

- Config `plugin` entries.
- Auto-discovered `.opencode/{plugin,plugins}/*.{ts,js}`.
- Auto-discovered `.opencode/{tool,tools}/*.{ts,js}`.
- Auto-discovered `.opencode/command/*` and `.opencode/agent/*`.
- `packages/extensions/zed` for Zed integration.
- `sdks/vscode/src/extension.ts` for VS Code SDK extension.

## Feature And Flag Gates

- Flag implementation: `packages/core/src/flag/flag.ts`
- CLI global flags: `packages/opencode/src/index.ts`
- Server backend flag use: `packages/opencode/src/server/backend.ts`
- Tool registry flag gates: `packages/opencode/src/tool/registry.ts`
- Config flag overlays: `packages/opencode/src/config/config.ts`
- Model metadata flags: `packages/opencode/src/provider/models.ts`

Important flags:

- `OPENCODE_PURE`: skip external plugins.
- `OPENCODE_DB`: override SQLite path.
- `OPENCODE_SKIP_MIGRATIONS`: no-op migration SQL.
- `OPENCODE_DISABLE_CHANNEL_DB`: force standard DB path.
- `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG_CONTENT`
- `OPENCODE_DISABLE_PROJECT_CONFIG`
- `OPENCODE_PERMISSION`
- `OPENCODE_DISABLE_AUTOCOMPACT`, `OPENCODE_DISABLE_PRUNE`
- `OPENCODE_EXPERIMENTAL_HTTPAPI`
- `OPENCODE_EXPERIMENTAL_WORKSPACES`
- `OPENCODE_EXPERIMENTAL_PLAN_MODE`
- `OPENCODE_EXPERIMENTAL_LSP_TOOL`
- `OPENCODE_ENABLE_EXA`
- `OPENCODE_ENABLE_QUESTION_TOOL`
- `OPENCODE_ENABLE_EXPERIMENTAL_MODELS`
- `OPENCODE_MODELS_URL`, `OPENCODE_MODELS_PATH`, `OPENCODE_DISABLE_MODELS_FETCH`
- `OPENCODE_SERVER_PASSWORD`, `OPENCODE_SERVER_USERNAME`
- `OPENCODE_CLIENT`

## Shell, PTY, Files, LSP, Snapshots

- Shell helpers: `packages/opencode/src/shell/shell.ts`
- PTY service: `packages/opencode/src/pty/index.ts`
- PTY input/schema: `packages/opencode/src/pty/input.ts`, `packages/opencode/src/pty/schema.ts`
- PTY platform adapters: `packages/opencode/src/pty/pty.bun.ts`, `packages/opencode/src/pty/pty.node.ts`
- File service: `packages/opencode/src/file/index.ts`
- File ignore/protection: `packages/opencode/src/file/ignore.ts`, `packages/opencode/src/file/protected.ts`
- Ripgrep service: `packages/opencode/src/file/ripgrep.ts`
- File watcher: `packages/opencode/src/file/watcher.ts`
- LSP service: `packages/opencode/src/lsp/lsp.ts`
- LSP client/server/launch: `packages/opencode/src/lsp/client.ts`, `server.ts`, `launch.ts`
- LSP diagnostics/language: `packages/opencode/src/lsp/diagnostic.ts`, `language.ts`
- Snapshot service: `packages/opencode/src/snapshot/index.ts`
- Patch helper: `packages/opencode/src/patch/index.ts`
- Formatter service: `packages/opencode/src/format/index.ts`, `packages/opencode/src/format/formatter.ts`

Snapshots are captured before model stream and at step boundaries. Processor emits `patch` parts when snapshot diff contains file changes. Revert uses session snapshots and diff metadata to undo/restore effects.

## Share And Console

- Session share service: `packages/opencode/src/share/session.ts`
- Share transport: `packages/opencode/src/share/share-next.ts`
- Share SQL: `packages/opencode/src/share/share.sql.ts`
- Account service: `packages/opencode/src/account/account.ts`
- Account repository/schema: `packages/opencode/src/account/repo.ts`, `packages/opencode/src/account/schema.ts`
- Console core: `packages/console/core/src`
- Console app: `packages/console/app/src`
- Console functions: `packages/console/function/src`

Sharing is controlled by config `share`, `OPENCODE_AUTO_SHARE`, and account/console state. CLI `run --share` forces share for created/continued session.

## Build And Packaging

- Root package: `package.json`
- OpenCode package: `packages/opencode/package.json`
- Build script: `packages/opencode/script/build.ts`
- Binary wrapper: `packages/opencode/bin/opencode`
- Install script: `install`
- Nix package: `nix/opencode.nix`
- Containers: `packages/containers/*`
- Release scripts: `script/release`, `packages/opencode/script/*`
- Generated OpenAPI: `packages/sdk/openapi.json`
- SDK generator output: `packages/sdk/js/src/gen`, `packages/sdk/js/src/v2/gen`

## Important Filepaths

Runtime core:

- `packages/opencode/src/index.ts`
- `packages/opencode/src/effect/app-runtime.ts`
- `packages/opencode/src/project/instance.ts`
- `packages/opencode/src/server/server.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/llm.ts`
- `packages/opencode/src/tool/registry.ts`
- `packages/opencode/src/provider/provider.ts`
- `packages/opencode/src/config/config.ts`
- `packages/opencode/src/storage/db.ts`
- `packages/opencode/src/sync/index.ts`
- `packages/opencode/src/bus/index.ts`

Public API:

- `packages/opencode/src/server/routes/instance/session.ts`
- `packages/opencode/src/server/routes/instance/event.ts`
- `packages/opencode/src/server/routes/instance/config.ts`
- `packages/opencode/src/server/routes/instance/provider.ts`
- `packages/opencode/src/server/routes/instance/permission.ts`
- `packages/opencode/src/server/routes/instance/mcp.ts`
- `packages/opencode/src/server/routes/instance/pty.ts`
- `packages/opencode/src/server/routes/instance/file.ts`
- `packages/sdk/js/src/v2/client.ts`

User interfaces:

- `packages/opencode/src/cli/cmd/run.ts`
- `packages/opencode/src/cli/cmd/serve.ts`
- `packages/opencode/src/cli/cmd/tui/app.tsx`
- `packages/app/src/app.tsx`
- `packages/app/src/pages/session.tsx`
- `packages/desktop-electron/src/main/index.ts`
- `packages/desktop-electron/src/renderer/index.tsx`

Extension surface:

- `packages/plugin/src/index.ts`
- `packages/opencode/src/plugin/index.ts`
- `packages/opencode/src/mcp/index.ts`
- `packages/opencode/src/acp/agent.ts`
- `packages/extensions/zed`
- `sdks/vscode/src/extension.ts`
