# Codex Implementation Map

Source root: `/Users/johnsuh/codex`

Purpose: map important Codex runtime features to implementation files. Paths below are relative to source root.

## Runtime Shape

Codex is native Rust runtime behind thin npm launcher. UI, exec mode, app server, MCP server, SDKs, and cloud task tooling submit protocol `Op`s into core session runtime and consume emitted `EventMsg`s.

Core flow:

1. Entrypoint parses command.
2. `ThreadManager` creates or resumes thread.
3. `Codex::spawn` creates `Session`, submission queue, event queue, background submission loop.
4. `submission_loop` dispatches `Op`.
5. User turn spawns task.
6. `run_turn` builds prompt, streams model output, dispatches tool calls, records history.
7. `LiveThread` persists rollout items and thread metadata.

## Entrypoints

- npm binary wrapper: `codex-cli/bin/codex.js`
- Rust CLI dispatch: `codex-rs/cli/src/main.rs`
- Interactive TUI: `codex-rs/tui/src/lib.rs`, `codex-rs/tui/src/app.rs`
- Non-interactive exec: `codex-rs/exec/src/lib.rs`, `codex-rs/exec/src/cli.rs`
- App server: `codex-rs/app-server/src/lib.rs`
- App-server request routing: `codex-rs/app-server/src/message_processor.rs`, `codex-rs/app-server/src/request_processors.rs`
- MCP server: `codex-rs/mcp-server/src/lib.rs`, `codex-rs/mcp-server/src/message_processor.rs`
- TypeScript SDK: `sdk/typescript/src/codex.ts`, `sdk/typescript/src/thread.ts`
- Python SDK: `sdk/python/src/codex_app_server/client.py`, `sdk/python/src/codex_app_server/async_client.py`

## Protocol

- Protocol root: `codex-rs/protocol/src/protocol.rs`
- Thread id: `codex-rs/protocol/src/thread_id.rs`
- Session id: `codex-rs/protocol/src/session_id.rs`
- Model wire items: `codex-rs/protocol/src/models.rs`
- Thread items: `codex-rs/protocol/src/items.rs`
- User input: `codex-rs/protocol/src/user_input.rs`
- Plan tool schema: `codex-rs/protocol/src/plan_tool.rs`
- Permissions models: `codex-rs/protocol/src/permissions.rs`
- Approval types: `codex-rs/protocol/src/approvals.rs`

Important protocol objects:

- `Submission`: inbound request envelope.
- `Op`: command submitted into session loop.
- `Event`: outbound event envelope.
- `EventMsg`: typed UI/app/server event payload.
- `SessionSource`: root, subagent, internal, exec, app-server source classification.

## Session Runtime

- Runtime interface: `codex-rs/core/src/session/mod.rs`
- Session object: `codex-rs/core/src/session/session.rs`
- Submission handlers: `codex-rs/core/src/session/handlers.rs`
- Turn loop: `codex-rs/core/src/session/turn.rs`
- Turn context: `codex-rs/core/src/session/turn_context.rs`
- Thread facade: `codex-rs/core/src/codex_thread.rs`
- Thread manager: `codex-rs/core/src/thread_manager.rs`
- Session state: `codex-rs/core/src/state/session.rs`
- Session services: `codex-rs/core/src/state/service.rs`
- Active turn state: `codex-rs/core/src/state/turn.rs`

Live state:

- `Codex`: submission sender, event receiver, `Arc<Session>`, session-loop termination handle.
- `Session`: thread id, event channel, active turn, mailbox, runtime services.
- `SessionState`: mutable config, context history, rate limits, dependency env, connector selection, previous turn settings.
- `SessionServices`: model client, MCP manager, exec manager, hooks, analytics, thread store, live thread, plugins, skills, agent control.

## Persistence

- Rollout recorder: `codex-rs/rollout/src/recorder.rs`
- Rollout list/read helpers: `codex-rs/rollout/src/list.rs`
- Rollout metadata: `codex-rs/rollout/src/metadata.rs`
- Rollout SQLite state: `codex-rs/rollout/src/state_db.rs`
- Thread store trait: `codex-rs/thread-store/src/store.rs`
- Live thread wrapper: `codex-rs/thread-store/src/live_thread.rs`
- Local thread store: `codex-rs/thread-store/src/local/mod.rs`
- Local live writer: `codex-rs/thread-store/src/local/live_writer.rs`
- Local read path: `codex-rs/thread-store/src/local/read_thread.rs`

Durable files:

```text
$CODEX_HOME/sessions/YYYY/MM/DD/rollout-YYYY-MM-DDThh-mm-ss-{thread_id}.jsonl
$CODEX_HOME/archived_sessions/...
```

`record_conversation_items` updates in-memory `ContextManager`, appends `RolloutItem::ResponseItem`, then emits raw response items. Compaction writes `RolloutItem::Compacted` and advances model-client window generation.

## Model Client

- Model client: `codex-rs/core/src/client.rs`
- Common prompt/stream types: `codex-rs/core/src/client_common.rs`
- Model provider abstraction: `codex-rs/model-provider/src/lib.rs`
- Model metadata: `codex-rs/model-provider-info/src/lib.rs`
- Model manager: `codex-rs/models-manager/src/manager.rs`
- OpenAI API client crate: `codex-rs/codex-api/src/lib.rs`

Important behavior:

- `ModelClient` is session-scoped.
- `ModelClientSession` is turn-scoped.
- Responses WebSocket and HTTP transports share request construction.
- WebSocket fallback is session-scoped after transport failure.
- `x-codex-turn-state` is turn-scoped sticky routing state.

## Prompt And Context

- Prompt construction: `codex-rs/core/src/session/turn.rs`
- Initial context builder: `codex-rs/core/src/session/mod.rs`
- Context manager: `codex-rs/core/src/context_manager/mod.rs`
- History normalization: `codex-rs/core/src/context_manager/normalize.rs`
- History prompt projection: `codex-rs/core/src/context_manager/history.rs`
- Context fragments: `codex-rs/core/src/context/fragment.rs`
- Environment context: `codex-rs/core/src/context/contextual_user_message.rs`
- Available skills instructions: `codex-rs/core/src/context/available_skills_instructions.rs`
- Available plugin instructions: `codex-rs/core/src/context/available_plugins_instructions.rs`
- Permissions instructions: `codex-rs/core/src/context/permissions_instructions.rs`

Prompt content combines base instructions, developer instructions, user instructions, environment context, permissions, skills, plugins, app connectors, realtime state, personality, memories, and turn history.

## Tool System

- Tool config: `codex-rs/tools/src/tool_config.rs`
- Tool registry plan: `codex-rs/core/src/tools/spec_plan.rs`
- Tool spec assembly: `codex-rs/core/src/tools/spec.rs`
- Tool router: `codex-rs/core/src/tools/router.rs`
- Tool registry: `codex-rs/core/src/tools/registry.rs`
- Tool context: `codex-rs/core/src/tools/context.rs`
- Tool parallel runtime: `codex-rs/core/src/tools/parallel.rs`
- Tool orchestration: `codex-rs/core/src/tools/orchestrator.rs`
- Hosted tool specs: `codex-rs/core/src/tools/hosted_spec.rs`
- Tool search entries: `codex-rs/core/src/tools/tool_search_entry.rs`
- Tool dispatch tracing: `codex-rs/core/src/tools/tool_dispatch_trace.rs`

Tool visibility is config/model/feature gated. Handler registration and model-visible specs are related but separate. Compatibility handlers can exist for tools not exposed to model.

## Baseline Tool Calls

Core:

- `update_plan`: `codex-rs/core/src/tools/handlers/plan.rs`
- `request_user_input`: `codex-rs/core/src/tools/handlers/request_user_input.rs`

Shell and process:

- `shell`: `codex-rs/core/src/tools/handlers/shell/shell_handler.rs`
- `local_shell`: `codex-rs/core/src/tools/handlers/shell/local_shell.rs`
- `shell_command`: `codex-rs/core/src/tools/handlers/shell/shell_command.rs`
- `container.exec`: `codex-rs/core/src/tools/handlers/shell/container_exec.rs`
- `exec_command`: `codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs`
- `write_stdin`: `codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs`

Filesystem and media:

- `apply_patch`: `codex-rs/core/src/tools/handlers/apply_patch.rs`
- `view_image`: `codex-rs/core/src/tools/handlers/view_image.rs`

Permissions:

- `request_permissions`: `codex-rs/core/src/tools/handlers/request_permissions.rs`

Discovery:

- `tool_search`: `codex-rs/core/src/tools/handlers/tool_search.rs`
- `request_plugin_install`: `codex-rs/core/src/tools/handlers/request_plugin_install.rs`

MCP resources:

- `list_mcp_resources`: `codex-rs/core/src/tools/handlers/mcp_resource/list_mcp_resources.rs`
- `list_mcp_resource_templates`: `codex-rs/core/src/tools/handlers/mcp_resource/list_mcp_resource_templates.rs`
- `read_mcp_resource`: `codex-rs/core/src/tools/handlers/mcp_resource/read_mcp_resource.rs`
- Namespaced MCP tools: `codex-rs/core/src/tools/handlers/mcp.rs`

Multi-agent:

- `spawn_agent`: `codex-rs/core/src/tools/handlers/multi_agents/spawn.rs`
- `send_input`: `codex-rs/core/src/tools/handlers/multi_agents/send_input.rs`
- `resume_agent`: `codex-rs/core/src/tools/handlers/multi_agents/resume_agent.rs`
- `wait_agent`: `codex-rs/core/src/tools/handlers/multi_agents/wait.rs`
- `close_agent`: `codex-rs/core/src/tools/handlers/multi_agents/close_agent.rs`

Multi-agent v2:

- `spawn_agent`: `codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs`
- `send_message`: `codex-rs/core/src/tools/handlers/multi_agents_v2/send_message.rs`
- `followup_task`: `codex-rs/core/src/tools/handlers/multi_agents_v2/followup_task.rs`
- `wait_agent`: `codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
- `close_agent`: `codex-rs/core/src/tools/handlers/multi_agents_v2/close_agent.rs`
- `list_agents`: `codex-rs/core/src/tools/handlers/multi_agents_v2/list_agents.rs`

Goals:

- `get_goal`: `codex-rs/core/src/tools/handlers/goal/get_goal.rs`
- `create_goal`: `codex-rs/core/src/tools/handlers/goal/create_goal.rs`
- `update_goal`: `codex-rs/core/src/tools/handlers/goal/update_goal.rs`

Hosted/model tools:

- `web_search`: `codex-rs/core/src/tools/hosted_spec.rs`
- `image_generation`: `codex-rs/core/src/tools/hosted_spec.rs`

Agent jobs:

- `spawn_agents_on_csv`: `codex-rs/core/src/tools/handlers/agent_jobs/spawn_agents_on_csv.rs`
- `report_agent_job_result`: `codex-rs/core/src/tools/handlers/agent_jobs/report_agent_job_result.rs`

Extension and dynamic tools:

- Dynamic thread tools: `codex-rs/core/src/tools/handlers/dynamic.rs`
- Extension bundles: `codex-rs/core/src/tools/handlers/extension_tools.rs`

## Feature Registry

- Feature enum and specs: `codex-rs/features/src/lib.rs`
- Feature config helpers: `codex-rs/features/src/feature_configs.rs`
- Feature aliases and removed names: `codex-rs/features/src/legacy.rs`
- Managed feature pins: `codex-rs/core/src/config/managed_features.rs`
- Config loading and feature derivation: `codex-rs/core/src/config/mod.rs`

Important feature flags from registry:

- `ShellTool`, `UnifiedExec`, `ShellZshFork`, `ShellSnapshot`
- `ApplyPatchFreeform`, `ApplyPatchStreamingEvents`
- `ToolSearch`, `ToolSearchAlwaysDeferMcpTools`, `ToolSuggest`, `UnavailableDummyTools`
- `Apps`, `EnableMcpApps`, `AppsMcpPathOverride`
- `Plugins`, `PluginHooks`, `RemotePlugin`
- `CodeMode`, `CodeModeOnly`
- `Collab`, `MultiAgentV2`, `SpawnCsv`
- `Goals`
- `ExecPermissionApprovals`, `RequestPermissionsTool`, `RequestRule`
- `CodexHooks`
- `ImageGeneration`
- `WebSearchRequest`, `WebSearchCached`, `SearchTool`
- `RealtimeConversation`
- `ResponsesWebsockets`, `ResponsesWebsocketsV2`, `ResponsesWebsocketResponseProcessed`
- `RemoteCompactionV2`
- `MemoryTool`, `WorkspaceDependencies`
- `NetworkProxy`
- `WindowsSandbox`, `WindowsSandboxElevated`
- `GuardianApproval`
- `Personality`
- `FastMode`
- `RemoteControl`
- `TuiAppServer`
- `InAppBrowser`, `BrowserUse`, `BrowserUseExternal`, `ComputerUse`
- `SkillMcpDependencyInstall`, `SkillEnvVarDependencyPrompt`
- `MentionsV2`, `DefaultModeRequestUserInput`

## Shell And Execution

- Shell feature derivation: `codex-rs/tools/src/tool_config.rs`
- Shell specs: `codex-rs/core/src/tools/handlers/shell_spec.rs`
- Shell handlers: `codex-rs/core/src/tools/handlers/shell.rs`
- Shell runtime: `codex-rs/core/src/tools/runtimes/shell.rs`
- Unified exec runtime: `codex-rs/core/src/tools/runtimes/unified_exec.rs`
- Core exec implementation: `codex-rs/core/src/exec.rs`
- Exec server: `codex-rs/exec-server/src/lib.rs`
- Shell command parsing: `codex-rs/shell-command/src/lib.rs`
- Shell escalation: `codex-rs/shell-escalation/src/lib.rs`
- Process manager: `codex-rs/core/src/unified_exec/process.rs`

Feature gates:

- `ShellTool` controls shell exposure.
- `UnifiedExec` selects `exec_command` and `write_stdin` when available.
- `ShellZshFork` switches shell command backend to zsh fork mode.
- `ShellSnapshot` captures reusable shell state.

## Apply Patch

- Tool handler: `codex-rs/core/src/tools/handlers/apply_patch.rs`
- Tool spec: `codex-rs/core/src/tools/handlers/apply_patch_spec.rs`
- Runtime: `codex-rs/core/src/tools/runtimes/apply_patch.rs`
- Parser and patch application crate: `codex-rs/apply-patch/src/lib.rs`
- Standalone executable: `codex-rs/apply-patch/src/standalone_executable.rs`

Feature gates:

- `ApplyPatchFreeform` exposes freeform tool.
- `ApplyPatchStreamingEvents` emits partial patch update events.

## Permissions And Sandboxing

- Permission models: `codex-rs/protocol/src/permissions.rs`
- Approval models: `codex-rs/protocol/src/approvals.rs`
- Sandbox compatibility: `codex-rs/core/src/sandboxing/mod.rs`
- Sandbox policy transforms: `codex-rs/sandboxing/src/policy_transforms.rs`
- Exec policy manager: `codex-rs/core/src/exec_policy.rs`
- Exec policy crate: `codex-rs/execpolicy/src/lib.rs`
- Network policy decisions: `codex-rs/core/src/network_policy_decision.rs`
- Network proxy loader: `codex-rs/core/src/network_proxy_loader.rs`
- Network proxy crate: `codex-rs/network-proxy/src/lib.rs`
- Linux sandbox: `codex-rs/linux-sandbox/src/lib.rs`
- Windows sandbox: `codex-rs/core/src/windows_sandbox.rs`, `codex-rs/windows-sandbox-rs/src/lib.rs`

Feature gates:

- `ExecPermissionApprovals` allows shell-like tools to request elevated permissions.
- `RequestPermissionsTool` exposes `request_permissions`.
- `NetworkProxy` enables managed network proxy.
- `WindowsSandbox` and `WindowsSandboxElevated` control Windows enforcement.

## MCP, Apps, Plugins

- MCP manager: `codex-rs/core/src/mcp.rs`
- Session MCP ops: `codex-rs/core/src/session/mcp.rs`
- MCP tool call handling: `codex-rs/core/src/mcp_tool_call.rs`
- MCP client crate: `codex-rs/codex-mcp/src/mcp/mod.rs`
- RMCP client: `codex-rs/rmcp-client/src/lib.rs`
- MCP resource tools: `codex-rs/core/src/tools/handlers/mcp_resource.rs`
- MCP server binary: `codex-rs/mcp-server/src/lib.rs`
- Connectors: `codex-rs/core/src/connectors.rs`
- Plugin manager: `codex-rs/core-plugins/src/lib.rs`
- Plugin core crate: `codex-rs/plugin/src/lib.rs`
- Core plugin loading: `codex-rs/core/src/plugins.rs`
- App-server apps API: `codex-rs/app-server/src/request_processors/apps_processor.rs`
- App-server plugin API: `codex-rs/app-server/src/request_processors/plugins.rs`

Feature gates:

- `Apps`, `EnableMcpApps`, `AppsMcpPathOverride`
- `Plugins`, `PluginHooks`, `RemotePlugin`
- `ToolCallMcpElicitation`, `AuthElicitation`

## Skills

- Skills manager: `codex-rs/core/src/skills/manager.rs`
- Skill injection: `codex-rs/core/src/skills/injection.rs`
- Skill loading: `codex-rs/core/src/skills/mod.rs`
- Core skills crate: `codex-rs/core-skills/src/lib.rs`
- Skills crate: `codex-rs/skills/src/lib.rs`
- Skill dependency install: `codex-rs/core/src/mcp_skill_dependencies.rs`
- Available skills prompt: `codex-rs/core/src/context/available_skills_instructions.rs`

Feature gates:

- `SkillMcpDependencyInstall`
- `SkillEnvVarDependencyPrompt`

## Multi-Agent

- Agent control: `codex-rs/core/src/agent/control.rs`
- Agent status: `codex-rs/core/src/agent/status.rs`
- Session multi-agent helpers: `codex-rs/core/src/session/multi_agents.rs`
- Original multi-agent tools: `codex-rs/core/src/tools/handlers/multi_agents/`
- Multi-agent v2 tools: `codex-rs/core/src/tools/handlers/multi_agents_v2/`
- Agent role spec: `codex-rs/core/src/agent/role/`
- Subagent notification context: `codex-rs/core/src/context/subagent_notification.rs`
- External agent sessions: `codex-rs/external-agent-sessions/src/lib.rs`
- External agent config migration: `codex-rs/external-agent-migration/src/lib.rs`

Feature gates:

- `Collab` enables multi-agent tools.
- `MultiAgentV2` switches to v2 tool family.
- `SpawnCsv` adds agent-job fanout.

## Hooks

- Hook runtime: `codex-rs/core/src/hook_runtime.rs`
- Hook crate: `codex-rs/hooks/src/lib.rs`
- TUI hook UI: `codex-rs/tui/src/hooks_rpc.rs`
- Hook history cell: `codex-rs/tui/src/history_cell/hook_cell.rs`

Feature gates:

- `CodexHooks`
- `PluginHooks`

## Goals

- Goal runtime: `codex-rs/core/src/goals.rs`
- Goal tool handlers: `codex-rs/core/src/tools/handlers/goal/`
- TUI goal display: `codex-rs/tui/src/goal_display.rs`
- TUI goal actions: `codex-rs/tui/src/app/thread_goal_actions.rs`
- App-server goal processor: `codex-rs/app-server/src/request_processors/thread_goal_processor.rs`

Feature gate: `Goals`

## Web Search And Image Generation

- Hosted specs: `codex-rs/core/src/tools/hosted_spec.rs`
- Web search details: `codex-rs/core/src/web_search.rs`
- Config web search mode resolution: `codex-rs/core/src/config/mod.rs`
- Image generation instructions: `codex-rs/core/src/context/image_generation_instructions.rs`
- Image loading utility: `codex-rs/utils/image/src/lib.rs`
- View image tool: `codex-rs/core/src/tools/handlers/view_image.rs`

Feature gates:

- `WebSearchRequest`
- `WebSearchCached`
- `SearchTool`
- `ImageGeneration`

## Realtime Conversation

- Session realtime handlers: `codex-rs/core/src/realtime_conversation.rs`
- Realtime context: `codex-rs/core/src/realtime_context.rs`
- Realtime prompt: `codex-rs/core/src/realtime_prompt.rs`
- Realtime WebRTC crate: `codex-rs/realtime-webrtc/src/lib.rs`
- TUI voice UI: `codex-rs/tui/src/voice.rs`
- TUI audio device: `codex-rs/tui/src/audio_device.rs`

Feature gate: `RealtimeConversation`

## Compaction And Memory

- Inline compaction: `codex-rs/core/src/compact.rs`
- Remote compaction: `codex-rs/core/src/compact_remote.rs`
- Remote compaction v2: `codex-rs/core/src/compact_remote_v2.rs`
- Context limit logic: `codex-rs/core/src/session/turn.rs`
- Memory usage helper: `codex-rs/core/src/memory_usage.rs`
- Memories read crate: `codex-rs/memories/read/src/lib.rs`
- Memories write crate: `codex-rs/memories/write/src/lib.rs`

Feature gates:

- `RemoteCompactionV2`
- `MemoryTool`
- `WorkspaceDependencies`

## Guardian And Review

- Guardian module: `codex-rs/core/src/guardian/`
- Guardian prompt: `codex-rs/core/src/guardian/prompt.rs`
- Guardian review session: `codex-rs/core/src/guardian/review_session.rs`
- Session review flow: `codex-rs/core/src/session/review.rs`
- Review task: `codex-rs/core/src/tasks/review.rs`
- Review prompts: `codex-rs/core/src/review_prompts.rs`
- Non-interactive review command: `codex-rs/exec/src/lib.rs`

Feature gate: `GuardianApproval`

## TUI

- TUI main: `codex-rs/tui/src/main.rs`
- TUI runtime: `codex-rs/tui/src/lib.rs`
- App state: `codex-rs/tui/src/app.rs`
- Event dispatch: `codex-rs/tui/src/app/event_dispatch.rs`
- App-server events: `codex-rs/tui/src/app/app_server_events.rs`
- Input handling: `codex-rs/tui/src/app/input.rs`
- Chat widget: `codex-rs/tui/src/chatwidget.rs`
- Composer input: `codex-rs/tui/src/public_widgets/composer_input.rs`
- History UI: `codex-rs/tui/src/app/history_ui.rs`
- History cells: `codex-rs/tui/src/history_cell.rs`
- Exec cell UI: `codex-rs/tui/src/exec_cell/`
- Diff rendering: `codex-rs/tui/src/diff_render.rs`
- Markdown rendering: `codex-rs/tui/src/markdown_render.rs`
- Resume picker: `codex-rs/tui/src/resume_picker.rs`
- Onboarding: `codex-rs/tui/src/onboarding/`
- Bottom pane user input: `codex-rs/tui/src/bottom_pane/request_user_input/`

Feature gates include `TuiAppServer`, `TerminalResizeReflow`, `PreventIdleSleep`, `InAppBrowser`, `BrowserUse`, `ComputerUse`.

## App Server

- Server runtime: `codex-rs/app-server/src/lib.rs`
- JSON-RPC message processor: `codex-rs/app-server/src/message_processor.rs`
- Thread lifecycle: `codex-rs/app-server/src/request_processors/thread_lifecycle.rs`
- Thread processor: `codex-rs/app-server/src/request_processors/thread_processor.rs`
- Turn processor: `codex-rs/app-server/src/request_processors/turn_processor.rs`
- Command exec processor: `codex-rs/app-server/src/request_processors/command_exec_processor.rs`
- Process exec processor: `codex-rs/app-server/src/request_processors/process_exec_processor.rs`
- FS processor: `codex-rs/app-server/src/request_processors/fs_processor.rs`
- MCP processor: `codex-rs/app-server/src/request_processors/mcp_processor.rs`
- Config processor: `codex-rs/app-server/src/request_processors/config_processor.rs`
- Environment processor: `codex-rs/app-server/src/request_processors/environment_processor.rs`
- Dynamic tools: `codex-rs/app-server/src/dynamic_tools.rs`
- Thread state: `codex-rs/app-server/src/thread_state.rs`
- Thread status: `codex-rs/app-server/src/thread_status.rs`

Feature gates:

- `RemoteControl`
- `TuiAppServer`

## Auth And Account

- Login crate: `codex-rs/login/src/lib.rs`
- CLI login commands: `codex-rs/cli/src/login.rs`
- TUI auth onboarding: `codex-rs/tui/src/onboarding/auth.rs`
- Local ChatGPT auth UI: `codex-rs/tui/src/local_chatgpt_auth.rs`
- Keyring store: `codex-rs/keyring-store/src/lib.rs`
- Account protocol: `codex-rs/protocol/src/account.rs`
- App-server account processor: `codex-rs/app-server/src/request_processors/account_processor.rs`

## Telemetry And Tracing

- OpenTelemetry crate: `codex-rs/otel/src/lib.rs`
- Analytics crate: `codex-rs/analytics/src/lib.rs`
- Analytics facts: `codex-rs/analytics/src/facts.rs`
- Analytics events: `codex-rs/analytics/src/events.rs`
- Turn timing: `codex-rs/core/src/turn_timing.rs`
- Rollout trace: `codex-rs/rollout-trace/src/lib.rs`
- Response debug context: `codex-rs/response-debug-context/src/lib.rs`

Feature gates:

- `RuntimeMetrics`
- `ResponsesWebsocketResponseProcessed`

## Extension Points

- Extension API: `codex-rs/ext/extension-api/src/lib.rs`
- Extension tool bundles: `codex-rs/core/src/tools/handlers/extension_tools.rs`
- Thread start contributors: `codex-rs/core/src/session/session.rs`
- Context contributors: `codex-rs/core/src/session/mod.rs`
- Dynamic tools app-server surface: `codex-rs/app-server/src/dynamic_tools.rs`

## Code Mode

- Code mode crate: `codex-rs/code-mode/src/lib.rs`
- Core tool integration: `codex-rs/core/src/tools/code_mode/`
- Execute tool spec: `codex-rs/core/src/tools/code_mode/execute_spec.rs`
- Execute handler: `codex-rs/core/src/tools/code_mode/execute_handler.rs`
- Wait handler: `codex-rs/core/src/tools/code_mode/wait_handler.rs`

Feature gates:

- `CodeMode`
- `CodeModeOnly`

## Config

- Config root: `codex-rs/core/src/config/mod.rs`
- Config TOML schema types: `codex-rs/config/src/config_toml.rs`
- Config edit API: `codex-rs/core/src/config/edit.rs`
- Config lock: `codex-rs/core/src/session/config_lock.rs`
- CLI config overrides: `codex-rs/utils/cli/src/lib.rs`
- Approval presets: `codex-rs/utils/approval-presets/src/lib.rs`

Config decides model provider, permissions, feature flags, tools, MCP servers, plugins, skills, hooks, cwd, sandbox profile, auth, and app-server capabilities.
