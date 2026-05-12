# Pi Coding Agent Implementation Map

Source root: `/Users/johnsuh/pi-mono`

Inspected commit: `3d9e14d7482f4a99d5224926099bec0d17ff86fd`

Purpose: map Pi coding-agent runtime features to implementation files. Paths below are relative to source root.

## Runtime Shape

Pi coding agent is TypeScript CLI/TUI/RPC runtime built on `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai`.

Core flow:

1. CLI entrypoint parses command, settings, resource paths, model scope, session flags, and run mode.
2. `createAgentSessionServices` creates cwd-bound services: auth, settings, model registry, resource loader.
3. `createAgentSessionFromServices` creates low-level `Agent`, wraps it in `AgentSession`, and binds tool/runtime state.
4. Mode layer binds extension UI/command contexts.
5. `AgentSession.prompt` expands slash commands, prompt templates, skills, images, and pending messages.
6. `Agent.prompt` starts low-level `agentLoop`.
7. `runLoop` streams model output, validates and executes tool calls, drains steering/follow-up queues, emits events.
8. `AgentSession` serializes events through `_agentEventQueue`, persists session entries, runs extension hooks, compacts/retries when needed.
9. Mode layer renders events to TUI, text, JSON, or RPC protocol.

Main ownership:

- `packages/agent`: generic stateful agent loop, tool execution, event stream, harness utilities.
- `packages/coding-agent`: CLI application, sessions, settings, built-in tools, extensions, TUI, RPC, SDK.
- `packages/ai`: model/provider transport, messages, OAuth, stream protocol. Referenced heavily, not mapped in detail here.
- `packages/tui`: terminal UI components and input runtime. Referenced by interactive mode and extensions.

## Entrypoints

- npm binary: `packages/coding-agent/package.json`
- CLI bootstrap: `packages/coding-agent/src/cli.ts`
- Main CLI dispatch: `packages/coding-agent/src/main.ts`
- Bun binary bootstrap: `packages/coding-agent/src/bun/cli.ts`
- Bun Bedrock registration: `packages/coding-agent/src/bun/register-bedrock.ts`
- Bun sandbox env restore: `packages/coding-agent/src/bun/restore-sandbox-env.ts`
- Public SDK exports: `packages/coding-agent/src/index.ts`
- Coding-agent SDK factory: `packages/coding-agent/src/core/sdk.ts`
- Agent-core public exports: `packages/agent/src/index.ts`
- Agent-core class: `packages/agent/src/agent.ts`
- Agent-core loop: `packages/agent/src/agent-loop.ts`

Run modes:

- Interactive TUI: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- Print/text/json mode: `packages/coding-agent/src/modes/print-mode.ts`
- RPC mode: `packages/coding-agent/src/modes/rpc/rpc-mode.ts`
- Mode barrel: `packages/coding-agent/src/modes/index.ts`

Package management commands:

- CLI package command dispatch: `packages/coding-agent/src/package-manager-cli.ts`
- Package/resource manager: `packages/coding-agent/src/core/package-manager.ts`

## CLI

- Argument parser and help: `packages/coding-agent/src/cli/args.ts`
- Config selector: `packages/coding-agent/src/cli/config-selector.ts`
- Initial message builder: `packages/coding-agent/src/cli/initial-message.ts`
- File argument processor: `packages/coding-agent/src/cli/file-processor.ts`
- Model listing: `packages/coding-agent/src/cli/list-models.ts`
- Session picker: `packages/coding-agent/src/cli/session-picker.ts`

Important flags:

- Mode: `--print`, `--mode text`, `--mode json`, `--mode rpc`
- Session: `--continue`, `--resume`, `--session`, `--fork`, `--no-session`, `--session-dir`
- Model: `--provider`, `--model`, `--models`, `--thinking`, `--api-key`
- Prompt/resources: `--system-prompt`, `--append-system-prompt`, `@file`
- Tools: `--tools`, `--no-tools`, `--no-builtin-tools`
- Resources: `--extension`, `--skill`, `--prompt-template`, `--theme`
- Suppression: `--no-extensions`, `--no-skills`, `--no-prompt-templates`, `--no-themes`, `--no-context-files`
- Extension flags: unknown `--flag` values are collected and validated against loaded extension flags.

Mode selection:

- `--mode rpc` starts JSONL RPC.
- `--mode json` emits JSON event stream.
- `--print` or piped stdin starts print mode.
- TTY without print/json/rpc starts interactive TUI.

## Protocol

Agent-core events:

- Types: `packages/agent/src/types.ts`
- Loop emission: `packages/agent/src/agent-loop.ts`
- Event stream primitive comes from `@earendil-works/pi-ai`.

Core `AgentEvent` variants:

- `agent_start`, `agent_end`
- `turn_start`, `turn_end`
- `message_start`, `message_update`, `message_end`
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`

Coding-agent session events:

- Session event union: `packages/coding-agent/src/core/agent-session.ts`
- Extension event types: `packages/coding-agent/src/core/extensions/types.ts`

Additional `AgentSessionEvent` variants:

- `queue_update`
- `compaction_start`, `compaction_end`
- `session_info_changed`
- `thinking_level_changed`
- `auto_retry_start`, `auto_retry_end`

RPC wire protocol:

- JSONL reader/writer: `packages/coding-agent/src/modes/rpc/jsonl.ts`
- Command/response types: `packages/coding-agent/src/modes/rpc/rpc-types.ts`
- Command router: `packages/coding-agent/src/modes/rpc/rpc-mode.ts`

RPC commands:

- Prompting: `prompt`, `steer`, `follow_up`, `abort`, `new_session`
- State: `get_state`
- Model: `set_model`, `cycle_model`, `get_available_models`
- Thinking: `set_thinking_level`, `cycle_thinking_level`
- Queues: `set_steering_mode`, `set_follow_up_mode`
- Compaction: `compact`, `set_auto_compaction`
- Retry: `set_auto_retry`, `abort_retry`
- Bash: `bash`, `abort_bash`
- Session: `get_session_stats`, `export_html`, `switch_session`, `fork`, `clone`, `get_fork_messages`, `get_last_assistant_text`, `set_session_name`
- Messages and commands: `get_messages`, `get_commands`

RPC extension UI messages:

- Outbound requests: `extension_ui_request`
- Inbound responses: `extension_ui_response`
- Methods: `select`, `confirm`, `input`, `editor`, `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`

## Session Runtime

- Runtime host: `packages/coding-agent/src/core/agent-session-runtime.ts`
- Runtime services: `packages/coding-agent/src/core/agent-session-services.ts`
- Session facade: `packages/coding-agent/src/core/agent-session.ts`
- SDK creation: `packages/coding-agent/src/core/sdk.ts`
- Session cwd validation: `packages/coding-agent/src/core/session-cwd.ts`

Live objects:

- `Agent`: low-level mutable state, event subscribers, queues, active abort controller, stream function, hooks.
- `AgentSession`: application-level session facade over `Agent`, `SessionManager`, `SettingsManager`, resources, model registry, tool definitions, extensions, compaction, retry, bash, and session tree operations.
- `AgentSessionServices`: cwd-bound services created together: `authStorage`, `settingsManager`, `modelRegistry`, `resourceLoader`.
- `AgentSessionRuntime`: owns current `AgentSession` plus services and recreates them when cwd/session changes.

`AgentSessionRuntime` operations:

- `switchSession`: open target JSONL session and recreate runtime for target cwd.
- `newSession`: create new session file in current session dir.
- `fork`: fork around selected session entry, optionally before user entry or at entry.
- `importSession`: import external JSONL into current session dir.
- `dispose`: emit shutdown, invalidate extensions, dispose session.

`AgentSession` responsibilities:

- Event subscription and serialized internal event processing.
- Message persistence into `SessionManager`.
- Prompt template expansion and slash command dispatch.
- Tool registry construction and active tool selection.
- Extension hook execution and stale-context invalidation.
- Model/thinking selection and settings persistence.
- Auto retry and retry cancellation.
- Manual/automatic compaction and overflow recovery.
- Branch summaries and tree navigation.
- Bash command execution outside model tools.
- HTML export.

## Low-Level Agent Loop

- Agent state wrapper: `packages/agent/src/agent.ts`
- Loop implementation: `packages/agent/src/agent-loop.ts`
- Types: `packages/agent/src/types.ts`

`Agent.prompt` creates a run with new user messages. `Agent.continue` resumes from existing context for retry-style flows. Each active run has `promise`, `resolve`, and `AbortController`.

Loop structure:

- `runAgentLoop` appends prompt messages and emits prompt lifecycle events.
- `runAgentLoopContinue` starts from existing context.
- `runLoop` owns nested assistant/tool/follow-up loop.
- `streamAssistantResponse` converts `AgentMessage[]` to provider `Message[]`, calls stream function, emits streaming updates.
- `executeToolCalls` validates arguments and executes tools in configured mode.

Queue semantics:

- Steering messages inject before next assistant response while current run continues.
- Follow-up messages run after agent would otherwise stop.
- Queue mode is `all` or `one-at-a-time`.

Tool execution:

- Default execution mode is `parallel`.
- Tool calls are prepared/validated sequentially.
- Parallel-capable calls execute concurrently.
- Tool result messages preserve assistant source order.
- Per-tool `executionMode` can force sequential execution.

## Persistence

- Session manager and file format: `packages/coding-agent/src/core/session-manager.ts`
- Session cwd checks: `packages/coding-agent/src/core/session-cwd.ts`
- Session docs: `packages/coding-agent/docs/session-format.md`, `packages/coding-agent/docs/sessions.md`
- Migration command: `packages/coding-agent/scripts/migrate-sessions.sh`
- App migrations: `packages/coding-agent/src/migrations.ts`

Durable stores:

```text
~/.pi/agent/auth.json
~/.pi/agent/settings.json
~/.pi/agent/models.json
~/.pi/agent/sessions/...
<project>/.pi/settings.json
<project>/.pi/...
```

Config dir name comes from package `piConfig.configDir` and `CONFIG_DIR_NAME`: `.pi`.

Session format:

- JSONL file begins with `SessionHeader`.
- `CURRENT_SESSION_VERSION` is `3`.
- Entry ids are short UUID-derived ids.
- Tree structure is encoded with `parentId`.
- Current branch is selected by leaf id.

Session entry types:

- `message`
- `thinking_level_change`
- `model_change`
- `compaction`
- `branch_summary`
- `custom`
- `custom_message`
- `label`
- `session_info`

Important behavior:

- `message_end` persists user, assistant, tool-result, and custom messages.
- Model and thinking changes append explicit entries for restore.
- Compaction entries record summary, first kept entry id, token counts, and optional extension details.
- Branch summaries preserve context when navigating session tree.
- `custom` entries persist extension state but do not enter LLM context.
- `custom_message` entries can enter LLM context and optionally render in TUI.

Harness session stores:

- JSONL repo/storage: `packages/agent/src/harness/session/repo/jsonl.ts`, `packages/agent/src/harness/session/storage/jsonl.ts`
- Memory repo/storage: `packages/agent/src/harness/session/repo/memory.ts`, `packages/agent/src/harness/session/storage/memory.ts`
- Shared session types: `packages/agent/src/harness/session/repo/shared.ts`, `packages/agent/src/harness/session/session.ts`

## Model Providers

- Model registry: `packages/coding-agent/src/core/model-registry.ts`
- Model resolution and scoped model matching: `packages/coding-agent/src/core/model-resolver.ts`
- Provider display names: `packages/coding-agent/src/core/provider-display-names.ts`
- Auth storage: `packages/coding-agent/src/core/auth-storage.ts`
- Auth guidance: `packages/coding-agent/src/core/auth-guidance.ts`
- Config value resolution: `packages/coding-agent/src/core/resolve-config-value.ts`
- Model docs: `packages/coding-agent/docs/models.md`, `packages/coding-agent/docs/providers.md`, `packages/coding-agent/docs/custom-provider.md`

Model data sources:

- Built-in provider/model registry from `@earendil-works/pi-ai`.
- User models config at `models.json`.
- Extension-registered providers through `pi.registerProvider`.
- Runtime CLI/API-selected model.

Auth sources:

- Stored API keys and OAuth credentials in `auth.json`.
- Environment variables resolved by `@earendil-works/pi-ai`.
- Provider config values and commands from `models.json`.
- Runtime `--api-key`.

Request path:

- `createAgentSession` creates `Agent.streamFn`.
- Stream function resolves fresh auth each request through `ModelRegistry.getApiKeyAndHeaders`.
- Provider retry settings come from `SettingsManager.getProviderRetrySettings`.
- Attribution headers are added for OpenRouter and Cloudflare when telemetry is enabled.
- Extension hooks can mutate provider payload with `before_provider_request`.
- Extension hooks observe provider response with `after_provider_response`.

Model selection:

- Existing sessions restore saved provider/model when available and authenticated.
- Defaults come from settings, then provider defaults in `defaultModelPerProvider`.
- `--model` accepts exact `provider/model`, bare model id, substring, and `:<thinking>` suffix.
- `--models` creates scoped model cycle list.
- Thinking level is clamped to model capability.

Transport:

- `Settings.transport` forwards to `Agent.transport`.
- Provider requests use `streamSimple` unless caller supplies custom stream function.

## Prompt And Context

- System prompt builder: `packages/coding-agent/src/core/system-prompt.ts`
- Prompt templates: `packages/coding-agent/src/core/prompt-templates.ts`
- Skills: `packages/coding-agent/src/core/skills.ts`
- Context/resource loader: `packages/coding-agent/src/core/resource-loader.ts`
- Message conversion: `packages/coding-agent/src/core/messages.ts`
- CLI initial message: `packages/coding-agent/src/cli/initial-message.ts`

Prompt inputs:

- Built-in coding assistant prompt.
- Explicit `--system-prompt`.
- `--append-system-prompt` and configured append prompts.
- Project/global context files: `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`.
- Active tool snippets and guidelines.
- Loaded skills.
- Prompt templates.
- Extension `before_agent_start`, `context`, and resource discovery hooks.

Context files load order:

- Global context from agent dir.
- Ancestor project context files from root toward cwd.
- Duplicate paths ignored.

Template/resource behavior:

- Prompt templates can be file-backed and expanded before prompting.
- Skills can register commands when `enableSkillCommands` is enabled.
- Skills appear in system prompt only when read tool is active.
- `Settings.images.blockImages` replaces image blocks with text placeholders at LLM boundary.
- `Settings.images.autoResize` affects CLI file/clipboard image preparation.

Compaction context:

- Compaction code: `packages/coding-agent/src/core/compaction/index.ts`
- Compaction algorithm: `packages/coding-agent/src/core/compaction/compaction.ts`
- Branch summaries: `packages/coding-agent/src/core/compaction/branch-summarization.ts`
- Utilities: `packages/coding-agent/src/core/compaction/utils.ts`
- Docs: `packages/coding-agent/docs/compaction.md`

## Tool System

- Tool definitions barrel: `packages/coding-agent/src/core/tools/index.ts`
- Tool wrapper from extension definition to agent tool: `packages/coding-agent/src/core/tools/tool-definition-wrapper.ts`
- File mutation serialization: `packages/coding-agent/src/core/tools/file-mutation-queue.ts`
- Tool rendering helpers: `packages/coding-agent/src/core/tools/render-utils.ts`
- Output accumulation/truncation: `packages/coding-agent/src/core/tools/output-accumulator.ts`, `packages/coding-agent/src/core/tools/truncate.ts`
- Path safety helpers: `packages/coding-agent/src/core/tools/path-utils.ts`

Built-in tool definitions:

- `read`: `packages/coding-agent/src/core/tools/read.ts`
- `bash`: `packages/coding-agent/src/core/tools/bash.ts`
- `edit`: `packages/coding-agent/src/core/tools/edit.ts`
- `edit-diff`: `packages/coding-agent/src/core/tools/edit-diff.ts`
- `write`: `packages/coding-agent/src/core/tools/write.ts`
- `grep`: `packages/coding-agent/src/core/tools/grep.ts`
- `find`: `packages/coding-agent/src/core/tools/find.ts`
- `ls`: `packages/coding-agent/src/core/tools/ls.ts`

Default active tools:

- `read`
- `bash`
- `edit`
- `write`

Available built-ins:

- `read`
- `bash`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

Tool selection:

- `--tools` is allowlist and initial active set.
- `--no-tools` disables all tools.
- `--no-builtin-tools` disables default built-ins while leaving custom/extension tools available.
- Extensions can call `getActiveTools`, `getAllTools`, `setActiveTools`, and `refreshTools`.
- `AgentSession` maintains definition registry, prompt snippets, prompt guidelines, and executable `AgentTool`s separately.

Tool hooks:

- Low-level hooks are `Agent.beforeToolCall` and `Agent.afterToolCall`.
- `AgentSession` installs these once and delegates to active `ExtensionRunner`.
- Hook `tool_call` can block execution.
- Hook `tool_result` can replace content, details, and error state.

## Bash And Exec

- Bash executor: `packages/coding-agent/src/core/bash-executor.ts`
- User bash execution: `packages/coding-agent/src/core/agent-session.ts`
- Bash tool: `packages/coding-agent/src/core/tools/bash.ts`
- Exec utility for extensions: `packages/coding-agent/src/core/exec.ts`
- Shell utilities: `packages/coding-agent/src/utils/shell.ts`
- Child process utilities: `packages/coding-agent/src/utils/child-process.ts`

Two bash paths exist:

- Model tool `bash`, returns tool result to model and streams tool updates.
- User command bash through `AgentSession.executeBash`, persists `bashExecution` message and can be excluded from context.

Settings that affect shell:

- `shellPath`
- `shellCommandPrefix`
- terminal progress display
- detached child tracking/cleanup

## Features

Runtime features are settings/resource driven rather than central feature-flag enum.

Major feature areas:

- TUI chat, selectors, slash commands, keybindings.
- Print mode with final text output.
- JSON mode with event stream.
- RPC mode with command/response protocol and extension UI bridge.
- Session resume, continue, fork, tree navigation, labels, names.
- Prompt templates and skills.
- Extension system for hooks, tools, commands, shortcuts, flags, providers, renderers, UI.
- Built-in read/bash/edit/write/grep/find/ls tools.
- Auto compaction, manual compaction, branch summarization.
- Auto retry and provider retry.
- Model registry, custom providers, OAuth and API key auth.
- HTML export.
- Package manager for extension/resource packages.
- Themes and terminal image display.

## Config

- Config constants and paths: `packages/coding-agent/src/config.ts`
- Settings manager: `packages/coding-agent/src/core/settings-manager.ts`
- Keybindings: `packages/coding-agent/src/core/keybindings.ts`
- Defaults: `packages/coding-agent/src/core/defaults.ts`
- Docs: `packages/coding-agent/docs/settings.md`, `packages/coding-agent/docs/keybindings.md`, `packages/coding-agent/docs/themes.md`

Config roots:

- Agent dir: `getAgentDir()`, default under home config for Pi agent.
- Project config dir: `.pi`.
- Session dir: settings/CLI/env selected through `getSessionsDir` and `ENV_SESSION_DIR`.

Settings scopes:

- Global: `~/.pi/agent/settings.json`
- Project: `<cwd>/.pi/settings.json`
- Project settings override global settings with shallow object merge for nested objects.

Important settings:

- Model defaults: `defaultProvider`, `defaultModel`, `defaultThinkingLevel`, `enabledModels`
- Runtime: `transport`, `steeringMode`, `followUpMode`, `thinkingBudgets`
- Resources: `packages`, `extensions`, `skills`, `prompts`, `themes`
- Prompt/resource toggles: `enableSkillCommands`
- Compaction/retry: `compaction`, `branchSummary`, `retry`
- Terminal/UI: `theme`, `hideThinkingBlock`, `terminal`, `editorPaddingX`, `autocompleteMaxVisible`, `showHardwareCursor`, `doubleEscapeAction`, `treeFilterMode`
- Images: `images.autoResize`, `images.blockImages`
- Shell: `shellPath`, `shellCommandPrefix`
- Package/update: `npmCommand`, `quietStartup`, `collapseChangelog`, `enableInstallTelemetry`
- Persistence: `sessionDir`

File locking:

- Auth storage uses `proper-lockfile`.
- Settings storage uses `proper-lockfile`.

## TUI

- Interactive mode: `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- Components: `packages/coding-agent/src/modes/interactive/components/`
- Theme runtime: `packages/coding-agent/src/modes/interactive/theme/theme.ts`
- Bundled themes: `packages/coding-agent/src/modes/interactive/theme/dark.json`, `packages/coding-agent/src/modes/interactive/theme/light.json`
- Theme schema: `packages/coding-agent/src/modes/interactive/theme/theme-schema.json`
- Asset: `packages/coding-agent/src/modes/interactive/assets/clankolas.png`
- TUI docs: `packages/coding-agent/docs/tui.md`, `packages/coding-agent/docs/terminal-setup.md`, `packages/coding-agent/docs/tmux.md`, `packages/coding-agent/docs/windows.md`, `packages/coding-agent/docs/termux.md`

Important components:

- Assistant/user messages: `assistant-message.ts`, `user-message.ts`
- Tool rendering: `tool-execution.ts`
- Bash execution rendering: `bash-execution.ts`
- Diff rendering: `diff.ts`
- Footer/header/editor: `footer.ts`, `custom-editor.ts`, `extension-editor.ts`, `extension-input.ts`
- Selectors: `model-selector.ts`, `scoped-models-selector.ts`, `session-selector.ts`, `tree-selector.ts`, `settings-selector.ts`, `theme-selector.ts`, `extension-selector.ts`, `user-message-selector.ts`
- Auth: `login-dialog.ts`, `oauth-selector.ts`
- Compaction/tree messages: `compaction-summary-message.ts`, `branch-summary-message.ts`
- Extension/custom messages: `custom-message.ts`, `skill-invocation-message.ts`

Interactive mode binds:

- Extension UI methods to TUI selectors, overlays, widgets, footer/header, editor, autocomplete, theme, title, and notifications.
- Extension command context to session runtime operations.
- Agent events to chat components.
- Terminal signals to abort, suspend, exit, and cleanup.
- Clipboard image/text and `@file` handling.
- Slash commands and prompt/skill commands.

## Extensions

- Types/API: `packages/coding-agent/src/core/extensions/types.ts`
- Loader: `packages/coding-agent/src/core/extensions/loader.ts`
- Runner: `packages/coding-agent/src/core/extensions/runner.ts`
- Wrapper helpers: `packages/coding-agent/src/core/extensions/wrapper.ts`
- Barrel: `packages/coding-agent/src/core/extensions/index.ts`
- Extension docs: `packages/coding-agent/docs/extensions.md`
- Extension examples: `packages/coding-agent/examples/extensions/`

Load sources:

- Settings package resources.
- Settings/local extension paths.
- CLI `--extension`.
- SDK `extensionFactories`.

Loader behavior:

- Uses `jiti` for TypeScript extension modules.
- Provides virtual modules for Bun binary mode.
- Aliases both `@earendil-works/*` and `@mariozechner/*` package names.
- Creates shared `ExtensionRuntime` before core binding.
- Registration methods work during load; action methods throw until bound.

Extension registration API:

- `on`
- `registerTool`
- `registerCommand`
- `registerShortcut`
- `registerFlag`
- `registerMessageRenderer`
- `registerProvider`
- `unregisterProvider`

Extension events:

- Session: `session_start`, `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_compact`, `session_shutdown`, `session_before_tree`, `session_tree`
- Agent: `before_agent_start`, `agent_start`, `agent_end`, `turn_start`, `turn_end`
- Messages: `message_start`, `message_update`, `message_end`
- Tools: `tool_call`, `tool_result`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`
- Provider: `before_provider_request`, `after_provider_response`
- Input/user bash: `input`, `user_bash`
- Resources: `resources_discover`
- Model/thinking: `model_select`, `thinking_level_select`

Extension contexts:

- `ExtensionContext`: UI, cwd, read-only session manager, model registry, model, abort/idle/status helpers, compaction, system prompt.
- `ExtensionCommandContext`: adds wait, new/fork/tree/switch/reload.
- `ReplacedSessionContext`: command context after session replacement plus message send helpers.
- `ExtensionUIContext`: TUI/RPC/no-op UI abstraction.

Stale-context protection:

- Runtime invalidates old extension contexts after reload/session replacement.
- Captured contexts throw with guidance after invalidation.

## SDK

- Public exports: `packages/coding-agent/src/index.ts`
- SDK implementation: `packages/coding-agent/src/core/sdk.ts`
- Runtime services SDK: `packages/coding-agent/src/core/agent-session-services.ts`
- Runtime host SDK: `packages/coding-agent/src/core/agent-session-runtime.ts`
- SDK docs: `packages/coding-agent/docs/sdk.md`
- SDK examples: `packages/coding-agent/examples/sdk/`

Primary SDK functions:

- `createAgentSession`
- `createAgentSessionServices`
- `createAgentSessionFromServices`
- `createAgentSessionRuntime`

Primary SDK classes:

- `AgentSession`
- `AgentSessionRuntime`
- `AuthStorage`
- `ModelRegistry`
- `DefaultResourceLoader`
- `SettingsManager`
- `SessionManager`
- `DefaultPackageManager`
- `ExtensionRunner`

Tool SDK:

- `defineTool`
- `createReadTool`
- `createBashTool`
- `createEditTool`
- `createWriteTool`
- `createGrepTool`
- `createFindTool`
- `createLsTool`
- `createCodingTools`
- `createReadOnlyTools`
- `withFileMutationQueue`

SDK customization points:

- Custom model and thinking level.
- Custom tool definitions.
- Custom resource loader.
- Custom auth/settings/model/session managers.
- Extension factories.
- Context files, prompt templates, skills, themes.
- In-memory sessions and settings for tests/embedded runtimes.

## Agent Harness

- Harness facade: `packages/agent/src/harness/agent-harness.ts`
- Harness types: `packages/agent/src/harness/types.ts`
- Node execution env: `packages/agent/src/harness/env/nodejs.ts`
- Execution env abstraction: `packages/agent/src/harness/execution-env.ts`
- Harness messages: `packages/agent/src/harness/messages.ts`
- Harness system prompt: `packages/agent/src/harness/system-prompt.ts`
- Harness prompt templates: `packages/agent/src/harness/prompt-templates.ts`
- Harness skills: `packages/agent/src/harness/skills.ts`
- Harness compaction: `packages/agent/src/harness/compaction/`
- Harness docs: `packages/agent/docs/agent-harness.md`

Harness is lower-level reusable agent infrastructure. Coding-agent has parallel application-specific implementations for sessions, resources, compaction, and prompts under `packages/coding-agent/src/core/`.

## Export And Diagnostics

- HTML export: `packages/coding-agent/src/core/export-html/index.ts`
- HTML templates/assets: `packages/coding-agent/src/core/export-html/template.html`, `template.css`, `template.js`
- HTML tool renderer: `packages/coding-agent/src/core/export-html/tool-renderer.ts`
- ANSI conversion: `packages/coding-agent/src/core/export-html/ansi-to-html.ts`
- Diagnostics type: `packages/coding-agent/src/core/diagnostics.ts`
- Output guard: `packages/coding-agent/src/core/output-guard.ts`
- Timings: `packages/coding-agent/src/core/timings.ts`
- Telemetry: `packages/coding-agent/src/core/telemetry.ts`

## Utilities

- Clipboard: `packages/coding-agent/src/utils/clipboard.ts`, `clipboard-native.ts`, `clipboard-image.ts`
- Images: `packages/coding-agent/src/utils/image-resize.ts`, `image-convert.ts`, `exif-orientation.ts`, `mime.ts`, `photon.ts`
- Filesystem watch: `packages/coding-agent/src/utils/fs-watch.ts`
- Git helpers: `packages/coding-agent/src/utils/git.ts`
- Paths: `packages/coding-agent/src/utils/paths.ts`
- Frontmatter: `packages/coding-agent/src/utils/frontmatter.ts`
- Tool manager install helper: `packages/coding-agent/src/utils/tools-manager.ts`
- Version checks: `packages/coding-agent/src/utils/version-check.ts`
- User agent: `packages/coding-agent/src/utils/pi-user-agent.ts`
- Sleep: `packages/coding-agent/src/utils/sleep.ts`

## Tests

Agent-core tests:

- `packages/agent/test/agent-loop.test.ts`
- `packages/agent/test/agent.test.ts`
- `packages/agent/test/e2e.test.ts`
- `packages/agent/test/harness/`

Coding-agent test files are not included in mapped file list above, but package test command is `vitest --run` in `packages/coding-agent/package.json`.

## Important Docs

- Overview: `packages/coding-agent/docs/index.md`
- Quickstart: `packages/coding-agent/docs/quickstart.md`
- Usage: `packages/coding-agent/docs/usage.md`
- Settings: `packages/coding-agent/docs/settings.md`
- Sessions: `packages/coding-agent/docs/sessions.md`
- Session format: `packages/coding-agent/docs/session-format.md`
- RPC: `packages/coding-agent/docs/rpc.md`
- SDK: `packages/coding-agent/docs/sdk.md`
- Extensions: `packages/coding-agent/docs/extensions.md`
- Skills: `packages/coding-agent/docs/skills.md`
- Prompt templates: `packages/coding-agent/docs/prompt-templates.md`
- Models/providers: `packages/coding-agent/docs/models.md`, `packages/coding-agent/docs/providers.md`, `packages/coding-agent/docs/custom-provider.md`
- TUI/themes/keybindings: `packages/coding-agent/docs/tui.md`, `packages/coding-agent/docs/themes.md`, `packages/coding-agent/docs/keybindings.md`
- Packages: `packages/coding-agent/docs/packages.md`
- JSON mode: `packages/coding-agent/docs/json.md`
