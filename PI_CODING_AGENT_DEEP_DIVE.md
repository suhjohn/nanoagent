# Pi Coding Agent Deep Dive

Pi is full coding-agent product stack with SDK entrypoints.

It ships CLI, TUI, JSON/RPC modes, embeddable `AgentSession` SDK, lower-level `Agent` loop, extension system, session tree storage, model registry, provider abstraction, prompt resources, compaction, retry, and package manager. Nanoagent kernel expresses same execution concerns as caller-owned durable loop primitives.

Checked May 21, 2026:

- npm `@earendil-works/pi-coding-agent@0.75.4`
- npm `@earendil-works/pi-agent-core@0.75.4`
- npm `@earendil-works/pi-ai@0.75.4`
- Local source `/Users/johnsuh/pi-mono` at commit `3d9e14d7482f4a99d5224926099bec0d17ff86fd`
- Public docs under `pi.dev/docs/latest`
- GitHub repo `earendil-works/pi`

Examples use `declare const` for caller-owned stores, emitters, policies, filesystems, and app services.

## Surfaces

Pi exposes six practical surfaces.

- CLI/TUI: `pi`, interactive coding-agent app.
- Print mode: one-shot terminal automation via `pi -p`.
- JSON mode: newline-delimited event stream for shell and process integration.
- RPC mode: JSONL command/event protocol over stdio.
- SDK: `@earendil-works/pi-coding-agent`, centered on `AgentSession`.
- Core loop: `@earendil-works/pi-agent-core`, centered on `Agent`.

Package stack:

- `@earendil-works/pi-ai`: provider/model transport and streaming message protocol.
- `@earendil-works/pi-agent-core`: stateful tool-calling loop.
- `@earendil-works/pi-coding-agent`: coding-agent app, SDK, tools, sessions, resources, extensions.
- `@earendil-works/pi-tui`: terminal UI library.
- `@earendil-works/pi-web-ui`: web components.

Current Earendil package scope replaced earlier `@mariozechner/*` package names as public migration. Public `pi` CLI command remains `pi`.

## CLI Shape

Primary install path:

```bash
npm install -g @earendil-works/pi-coding-agent
pi
```

Main modes:

```bash
pi                              # interactive TUI
pi -p "Summarize this repo"      # print mode
pi --mode json "Review diff"     # JSON event stream
pi --mode rpc                    # JSONL RPC server on stdio
```

Caller ergonomics are product-oriented. CLI owns prompt assembly, model selection, tools, session persistence, compaction, retry, UI rendering, auth, slash commands, and extension loading. Caller controls through flags, settings, context files, packages, and extensions.

## CLI Options

Important CLI option groups:

```text
mode:       --print, --mode text, --mode json, --mode rpc
session:    --continue, --resume, --session, --fork, --no-session, --session-dir
model:      --provider, --model, --models, --thinking, --api-key, --list-models
prompt:     --system-prompt, --append-system-prompt, @file
tools:      --tools, --no-tools, --no-builtin-tools
resources:  --extension, --skill, --prompt-template, --theme
disable:    --no-extensions, --no-skills, --no-prompt-templates, --no-themes, --no-context-files
```

Mode selection is simple:

- `--mode rpc` starts JSONL RPC.
- `--mode json` emits JSON lines.
- `--print` or piped stdin starts non-interactive print mode.
- TTY without print/json/rpc starts interactive TUI.

## SDK Shape

Primary SDK entrypoint is `createAgentSession`.

```ts
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
});

const unsubscribe = session.subscribe((event) => {
  if (event.type !== "message_update") return;
  if (event.assistantMessageEvent.type !== "text_delta") return;
  process.stdout.write(event.assistantMessageEvent.delta);
});

await session.prompt("List files in current directory.");

unsubscribe();
session.dispose();
```

Caller ergonomics are session-oriented. `AgentSession` is application facade around lower-level `Agent`, session manager, settings, resources, model registry, tools, extension runner, compaction, retry, bash, and exports.

## SDK Options

`CreateAgentSessionOptions` in `0.75.4` exposes this shape:

```ts
createAgentSession({
  cwd,
  agentDir,
  authStorage,
  modelRegistry,
  model,
  thinkingLevel,
  scopedModels,
  noTools,
  tools,
  customTools,
  resourceLoader,
  sessionManager,
  settingsManager,
  sessionStartEvent,
});
```

Option ownership:

- `cwd`: project-local discovery root.
- `agentDir`: global config root, default `~/.pi/agent`.
- `authStorage`: credential source.
- `modelRegistry`: provider/model catalog plus auth resolution.
- `model`: current model object from `@earendil-works/pi-ai`.
- `thinkingLevel`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- `scopedModels`: model-cycle list.
- `noTools`: suppress all tools or built-in tools.
- `tools`: active tool allowlist.
- `customTools`: caller-provided `ToolDefinition[]`.
- `resourceLoader`: context files, extensions, skills, prompts, themes.
- `sessionManager`: JSONL or memory session store.
- `settingsManager`: global/project settings.
- `sessionStartEvent`: extension startup metadata.

Important boundary: Pi SDK options are runtime objects. Persist session files and app state. Recreate auth/model/resource/session managers per process.

## AgentSession API

`AgentSession` owns live coding-agent session.

Core operations:

```ts
await session.prompt("Fix failing tests.");
await session.steer("Prioritize auth tests.");
await session.followUp("After fix, summarize risk.");

await session.abort();
session.dispose();
```

Model and thinking controls:

```ts
declare const model: import("@earendil-works/pi-ai").Model<any>;

await session.setModel(model);
session.setThinkingLevel("high");
await session.cycleModel("forward");
session.cycleThinkingLevel();
```

Tool controls:

```ts
const activeToolNames = session.getActiveToolNames();
const tools = session.getAllTools();

session.setActiveToolsByName(["read", "grep", "bash"]);
```

Session controls:

```ts
session.setSessionName("checkout-refactor");

const stats = session.getSessionStats();
const usage = session.getContextUsage();
const htmlPath = await session.exportToHtml();
const jsonlPath = session.exportToJsonl();
```

Compaction and tree navigation:

```ts
await session.compact("Keep decisions, changed files, and test results.");

const result = await session.navigateTree("entry_abc123", {
  summarize: true,
  customInstructions: "Preserve abandoned branch risk.",
});
```

`AgentSessionRuntime` owns runtime session replacement.

## AgentSessionRuntime

`AgentSessionRuntime` owns current `AgentSession` and cwd-bound services. Use it when app must replace session and rebuild services.

```ts
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";

const createRuntime: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  sessionManager,
  sessionStartEvent,
}) => {
  const services = await createAgentSessionServices({ cwd });

  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
    })),
    services,
    diagnostics: services.diagnostics,
  };
};

const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  sessionManager: SessionManager.create(process.cwd()),
});

await runtime.newSession();
await runtime.switchSession("/tmp/session.jsonl");
await runtime.fork("entry_abc123", { position: "at" });
```

Caller ergonomics: runtime API matches full app needs. It handles session replacement, cwd changes, fork/import, service recreation, diagnostics, and extension invalidation.

## Low-Level Agent Core

`@earendil-works/pi-agent-core` exposes `Agent`, stateful tool-calling loop without coding-agent resources.

```ts
import { Agent, type AgentEvent, type AgentTool } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

declare const model: Model<any>;
declare const tools: AgentTool[];
declare function render(event: AgentEvent): void;

const agent = new Agent({
  initialState: {
    systemPrompt: "You are a focused code reviewer.",
    model,
    thinkingLevel: "medium",
    tools,
  },
});

agent.subscribe((event) => render(event));

await agent.prompt("Review current diff.");
```

`Agent` owns mutable transcript, event subscribers, active run lifecycle, steering queue, follow-up queue, model/thinking state, tool list, stream function, and hooks.

Core constructor options:

```ts
new Agent({
  initialState,
  convertToLlm,
  transformContext,
  streamFn,
  getApiKey,
  onPayload,
  onResponse,
  beforeToolCall,
  afterToolCall,
  prepareNextTurn,
  steeringMode,
  followUpMode,
  sessionId,
  thinkingBudgets,
  transport,
  maxRetryDelayMs,
  toolExecution,
});
```

This is closest Pi surface to nanoagent kernel. It remains stateful object runtime with in-memory lifecycle.

## Event Protocol

Core `AgentEvent` variants:

```text
agent_start
agent_end
turn_start
turn_end
message_start
message_update
message_end
tool_execution_start
tool_execution_update
tool_execution_end
```

`AgentSessionEvent` adds:

```text
queue_update
compaction_start
compaction_end
session_info_changed
thinking_level_changed
auto_retry_start
auto_retry_end
```

JSON mode and RPC mode stream this event model after app projection.

## RPC Mode

RPC mode turns Pi into stdio service.

```bash
pi --mode rpc --no-session
```

Protocol is strict JSONL:

- Commands are one JSON object per line on stdin.
- Responses are `type: "response"` objects.
- Agent/session events stream on stdout.
- Optional command `id` correlates response.
- Line delimiter is LF; clients must not split JSON strings on Unicode line separators.

Prompt command:

```json
{"id":"req-1","type":"prompt","message":"Review checkout code."}
```

During streaming, caller must choose queue behavior:

```json
{"id":"req-2","type":"prompt","message":"Focus on auth first.","streamingBehavior":"steer"}
{"id":"req-3","type":"follow_up","message":"Then summarize tests."}
```

Representative commands:

```text
prompt
steer
follow_up
abort
new_session
get_state
get_messages
set_model
cycle_model
get_available_models
set_thinking_level
cycle_thinking_level
set_steering_mode
set_follow_up_mode
compact
set_auto_compaction
set_auto_retry
abort_retry
bash
abort_bash
get_session_stats
export_html
switch_session
fork
clone
get_fork_messages
get_last_assistant_text
set_session_name
get_commands
```

Caller ergonomics: RPC is good for non-Node hosts, IDEs, and process isolation. TypeScript hosts get tighter control by importing `AgentSession` directly.

## Tools

Pi built-ins:

```text
read
bash
edit
write
grep
find
ls
```

Default active tools:

```text
read
bash
edit
write
```

Tool selection:

- `--tools` is allowlist and initial active set.
- `--no-tools` disables all tools.
- `--no-builtin-tools` disables default built-ins while leaving extension/custom tools available.
- SDK `tools` option sets active allowlist.
- `AgentSession.setActiveToolsByName()` changes active tools for future turns.

Custom SDK tool:

```ts
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

declare const tickets: {
  lookup(id: string): Promise<{ status: string; owner: string }>;
};

const lookupTicket = defineTool({
  name: "lookup_ticket",
  label: "Lookup Ticket",
  description: "Look up ticket status by ID.",
  parameters: Type.Object({
    id: Type.String(),
  }),
  async execute(_toolCallId, params) {
    const ticket = await tickets.lookup(params.id);

    return {
      content: [{ type: "text", text: JSON.stringify(ticket) }],
      details: ticket,
    };
  },
});

const { session } = await createAgentSession({
  customTools: [lookupTicket],
  tools: ["read", "grep", "lookup_ticket"],
});
```

Tool execution mode:

- Global default is `parallel`.
- `sequential` runs one tool at a time.
- `parallel` validates/prepares calls sequentially, executes parallel-capable calls concurrently, emits completion events in completion order, and stores tool-result messages in assistant source order.
- Per-tool `executionMode` can override.

## Permissions

Pi permission policy comes from extension hooks and active tool controls.

Extension `tool_call` can block:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;

    const command = event.input.command;
    if (typeof command !== "string") return;
    if (!command.includes("rm -rf")) return;

    const ok = await ctx.ui.confirm("Dangerous command", command);
    if (!ok) return { block: true, reason: "Denied by user." };
  });
}
```

Tool hooks also exist at `Agent` level:

```ts
import { Agent, type AgentOptions } from "@earendil-works/pi-agent-core";

declare const initialState: AgentOptions["initialState"];

const agent = new Agent({
  initialState,
  beforeToolCall: async ({ toolCall }) => {
    if (toolCall.name === "write") return { block: true, reason: "Read-only mode." };
  },
});
```

Caller ergonomics: policy is programmable and tied to Pi extension/runtime concepts. Nanoagent represents approval as durable hook control.

## Extensions

Extensions are TypeScript modules loaded with `jiti`.

Extension factory:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded.", "info");
  });

  pi.registerCommand("ticket", {
    description: "Open current ticket workflow.",
    handler: async (args) => {
      pi.sendUserMessage(`Investigate ticket ${args}`);
    },
  });
}
```

Extension registration API includes:

- `on`
- `registerTool`
- `registerCommand`
- `registerShortcut`
- `registerFlag`
- `registerMessageRenderer`
- `registerProvider`
- `unregisterProvider`
- `events`

Extension action context includes:

- UI methods: select, confirm, input, editor, notify, status, widget, title.
- Session state: name, labels, entries, custom messages.
- Tools: get/set active tools.
- Models: set model, thinking level, provider registration.
- Shell: `exec`.
- Session operations through command context.

Extension events cover:

```text
resources_discover
session_start
session_before_switch
session_before_fork
session_before_compact
session_compact
session_shutdown
session_before_tree
session_tree
context
before_provider_request
after_provider_response
before_agent_start
agent_start
agent_end
turn_start
turn_end
message_start
message_update
message_end
tool_execution_start
tool_execution_update
tool_execution_end
model_select
thinking_level_select
tool_call
tool_result
user_bash
input
```

Caller ergonomics: extensions are strong for Pi-native product customization. Kernel hooks fit smaller durable loops inside caller-owned apps.

## Models And Providers

Pi provider layer comes from `@earendil-works/pi-ai`.

Supported provider families in docs include:

- OpenAI
- Azure OpenAI Responses
- OpenAI Codex
- Anthropic
- Google Gemini
- Vertex AI
- Mistral
- Groq
- Cerebras
- Cloudflare AI Gateway
- Cloudflare Workers AI
- xAI
- OpenRouter
- Vercel AI Gateway
- MiniMax
- Together AI
- GitHub Copilot
- Amazon Bedrock
- OpenCode Zen
- OpenCode Go
- Fireworks
- Kimi For Coding
- Xiaomi MiMo
- OpenAI-compatible APIs such as Ollama, vLLM, and LM Studio

Authentication sources:

- OAuth through `/login` for subscription providers.
- API keys in environment variables.
- `~/.pi/agent/auth.json`.
- `models.json` provider config.
- CLI `--api-key`.

SDK model selection uses `ModelRegistry` and concrete `Model<any>` objects.

```ts
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const model = modelRegistry.find("anthropic", "claude-sonnet-4-20250514");

if (!model) throw new Error("Model unavailable.");

const { session } = await createAgentSession({ model, modelRegistry, authStorage });
```

Provider customization can happen through `models.json` or extension `registerProvider`.

## Prompt And Context

Pi prompt assembly uses:

- Built-in coding assistant prompt.
- `--system-prompt`.
- `--append-system-prompt`.
- Global/project `SYSTEM.md`.
- Global/project `APPEND_SYSTEM.md`.
- Global/project `AGENTS.md`.
- Global/project `CLAUDE.md`.
- Tool prompt snippets and guidelines.
- Loaded skills.
- Prompt templates.
- Extension hooks.
- Resource discovery.

Context file loading order:

1. Global context from agent dir.
2. Ancestor project context files from root toward cwd.
3. Current directory context files.
4. Duplicate paths ignored.

Extension `context` hook can transform context before model call. Low-level `Agent.transformContext` can transform `AgentMessage[]` before `convertToLlm`.

```ts
import { Agent, type AgentOptions } from "@earendil-works/pi-agent-core";

declare const initialState: AgentOptions["initialState"];

const agent = new Agent({
  initialState,
  transformContext: async (messages) => {
    return messages.slice(-40);
  },
});
```

Caller ergonomics: Pi owns rich prompt resource system. Kernel keeps prompt assembly in `onTurnPrepared`.

## Sessions

Pi sessions are JSONL files under `~/.pi/agent/sessions/`, organized by working directory unless caller overrides.

Session entries include:

- `message`
- `thinking_level_change`
- `model_change`
- `compaction`
- `branch_summary`
- `custom`
- `custom_message`
- `label`
- `session_info`

Session tree uses entry ids and `parentId`. Current branch is selected by active leaf. `/tree` can jump within same file. `/fork` and `/clone` create separate session files.

SDK persistence choices:

```ts
import { SessionManager } from "@earendil-works/pi-coding-agent";

const fileBacked = SessionManager.create(process.cwd());
const memoryBacked = SessionManager.inMemory();
```

Caller ergonomics: Pi session model is user-facing product feature. It stores branchable conversations and app entries. Kernel state is lower-level durable execution snapshot.

## Compaction And Retry

Pi has manual and automatic compaction:

```ts
await session.compact("Keep unresolved questions and files changed.");
session.setAutoCompactionEnabled(true);
session.abortCompaction();
```

Compaction entries record summary, first kept entry id, token counts, and extension details.

Branch summaries preserve context when navigating away from branch.

Auto retry handles retryable provider errors. Context overflow is handled by compaction path.

```ts
session.setAutoRetryEnabled(true);
session.abortRetry();
```

Caller ergonomics: Pi includes product-ready behavior. Kernel leaves compaction and retry as hooks/middleware/storage policy.

## Bash And Shell

Pi has two bash paths.

- Model tool `bash`: result enters tool-result flow.
- User command bash: `!command` or `AgentSession.executeBash()`, can be included or excluded from LLM context.

```ts
const result = await session.executeBash(
  "npm test -- --runInBand",
  (chunk) => process.stdout.write(chunk),
  { excludeFromContext: false },
);
```

Settings affect shell:

- `shellPath`
- `shellCommandPrefix`
- terminal progress display
- detached child tracking and cleanup

Caller ergonomics: Pi shell is integrated with TUI/session model. Kernel treats shell as one caller-owned tool.

## Resources And Packages

Pi resource types:

- extensions
- skills
- prompt templates
- themes
- context files
- packages

Package sources:

- npm packages
- git repositories
- local paths

Resource loading comes from global config, project config, CLI flags, package resources, and `ResourceLoader`.

SDK caller can replace `resourceLoader` to own discovery:

```ts
import type { ResourceLoader } from "@earendil-works/pi-coding-agent";

declare const resourceLoader: ResourceLoader;

const { session } = await createAgentSession({ resourceLoader });
```

## Caller Ergonomics

Pi fits apps that want full coding-agent product.

Strong parts:

- Mature CLI/TUI coding experience.
- Embeddable `AgentSession`.
- JSON and RPC process integration.
- Session tree, branch navigation, fork, clone, export.
- Rich extension API.
- Built-in coding tools.
- Provider/model registry across many vendors.
- OAuth and API key flows.
- Prompt templates, skills, context files, themes.
- Compaction, branch summaries, retry, bash, package manager.

Sharp parts:

- SDK imports product runtime.
- Extension model is Pi-specific.
- Session format is Pi product state.
- Caller must understand `AgentSession` versus `AgentSessionRuntime`.
- Runtime managers are process-local objects.
- Durable state is JSONL session tree.
- Permissions are extension/tool policy patterns.
- Direct embedding requires TypeScript/Node; other hosts use subprocess RPC.

## Nanoagent Kernel Comparison

Kernel expresses same capabilities as smaller durable loop.

Pi answers product questions for caller: UI, session tree, slash commands, auth, model registry, context files, compaction, retry, extensions, tools, provider transport, package resources, and rendering. Kernel keeps those outside execution core.

### Construction

Pi SDK:

```ts
import {
  createAgentSession,
  type AuthStorage,
  type ModelRegistry,
  type SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

declare const authStorage: AuthStorage;
declare const cwd: string;
declare const customTools: ToolDefinition[];
declare const modelRegistry: ModelRegistry;
declare const sessionManager: SessionManager;

const { session } = await createAgentSession({
  cwd,
  sessionManager,
  modelRegistry,
  authStorage,
  customTools,
});

await session.prompt("Fix checkout tests.");
```

Kernel:

```ts
import {
  runAgent,
  type AgentHooks,
  type AgentRunState,
  type AgentSaveState,
  type AgentStreamEvent,
} from "@nanoagent/kernel";
import type { ToolSet } from "ai";

type Context = {
  threadId: string;
};

declare const emit: (event: AgentStreamEvent) => Promise<void>;
declare const hooks: AgentHooks<Context>;
declare const saveState: AgentSaveState<Context>;
declare const state: AgentRunState<Context> | { context: Context };
declare const tools: ToolSet;

for await (const event of runAgent({
  state,
  hooks,
  tools,
  saveState,
  maxTurns: 20,
})) {
  await emit(event);
}
```

Kernel variation: wrap `runAgent` into CLI, TUI, RPC, HTTP, queue worker, eval runner, or hosted session service.

### Model Routing

Pi uses `ModelRegistry`, `Model<any>`, `session.setModel`, scoped model cycling, thinking levels, settings, and extension provider registration.

Kernel routes model in `onTurnPrepared`.

```ts
import type { ModelMessage } from "ai";
import type { AgentHooks } from "@nanoagent/kernel";

type Context = {
  messages: ModelMessage[];
  model: string;
  retryModel?: string;
  retrying: boolean;
};

const hooks: AgentHooks<Context> = {
  onTurnPrepared: ({ context }) => ({
    value: {
      model: context.retrying && context.retryModel ? context.retryModel : context.model,
      messages: context.messages,
    },
  }),
};
```

Kernel variation: route by tenant, provider auth, eval arm, cost budget, queue priority, prior failure, or data boundary. Persist selected route in state.

### Prompt And Context

Pi loads context files, prompt templates, skills, tool snippets, extension context, and session history.

Kernel prompt assembly is caller hook.

```ts
import type { ModelMessage } from "ai";
import type { AgentHooks, Turn } from "@nanoagent/kernel";

type Context = {
  threadId: string;
  model: string;
  contextFilePaths: string[];
  memoryKeys: string[];
};

declare const promptBuilder: {
  messages(params: {
    threadId: string;
    turns: readonly Turn[];
    contextFilePaths: string[];
    memoryKeys: string[];
  }): Promise<ModelMessage[]>;
};

const hooks: AgentHooks<Context> = {
  onTurnPrepared: async ({ context, state }) => ({
    value: {
      model: context.model,
      messages: await promptBuilder.messages({
        threadId: context.threadId,
        turns: state.turns,
        contextFilePaths: context.contextFilePaths,
        memoryKeys: context.memoryKeys,
      }),
    },
  }),
};
```

Kernel variation: load Pi-style `AGENTS.md`, Claude-style `CLAUDE.md`, product docs, vector chunks, task state, branch summaries, or compacted transcript.

### Tools

Pi tools are TypeBox `ToolDefinition` and Pi `AgentTool` objects.

Kernel tools are Vercel AI SDK `ToolSet`.

```ts
import { jsonSchema, tool, type ToolSet } from "ai";

type Context = {
  workspaceId: string;
};

declare const workspace: {
  read(params: { workspaceId: string; path: string }): Promise<string>;
};

const tools = {
  read: tool({
    description: "Read UTF-8 file content from workspace.",
    inputSchema: jsonSchema<{ path: string }>({
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    }),
    execute: async ({ path }, options) => {
      const context = options.experimental_context as Context;
      return await workspace.read({ workspaceId: context.workspaceId, path });
    },
  }),
} satisfies ToolSet;
```

Kernel variation: use Pi-like tool names, product-domain tools, MCP adapters, sandbox RPC tools, browser tools, queue-backed tools, or no filesystem tools.

### Approval And Policy

Pi blocks or modifies tools through extension `tool_call` / `tool_result` or low-level `beforeToolCall` / `afterToolCall`.

Kernel uses hook control.

```ts
import type { AgentHooks } from "@nanoagent/kernel";

type Context = {
  approvedToolCallIds: string[];
};

declare function requiresApproval(params: {
  toolName: string;
  input: unknown;
}): boolean;

const hooks: AgentHooks<Context> = {
  onToolCallStarted: ({ context, toolCallId, toolName, input }) => {
    if (context.approvedToolCallIds.includes(toolCallId)) return;
    if (!requiresApproval({ toolName, input })) return;

    return {
      control: {
        type: "pause",
        reason: "approval_required",
        metadata: { toolCallId, toolName, input },
      },
    };
  },
};
```

Kernel variation: pause before model call, pause before tool batch, skip tool with denial result, rewrite tool input, finish run from policy, or count approvals in durable context.

### Queues And Steering

Pi has steering and follow-up queues. Steering injects after current assistant turn and tool calls. Follow-up injects after agent would otherwise stop. Queue mode is `all` or `one-at-a-time`.

Kernel can express same behavior in caller state.

```ts
import type { AgentHooks, Turn } from "@nanoagent/kernel";

type QueuedMessage = {
  text: string;
};

type Context = {
  model: string;
  messages: Array<{ role: "user"; content: string }>;
  steering: QueuedMessage[];
  followUp: QueuedMessage[];
};

declare function toModelMessages(
  messages: Context["messages"],
): Promise<import("ai").ModelMessage[]>;
declare function appendCompletedTurn(context: Context, turn: Turn): Context;

const hooks: AgentHooks<Context> = {
  onTurnPrepared: async ({ context }) => ({
    value: {
      model: context.model,
      messages: await toModelMessages(context.messages),
    },
  }),
  onTurnCompleted: ({ context, turn }) => {
    const next = appendCompletedTurn(context, turn);
    const [steer, ...steering] = next.steering;
    if (!steer) return { context: next };

    return {
      context: {
        ...next,
        steering,
        messages: [...next.messages, { role: "user", content: steer.text }],
      },
      control: { type: "continue" },
    };
  },
};
```

Kernel variation: drain all, drain one, prioritize interrupt class, persist queue separately, or expose queue through RPC protocol.

### Sessions And Branches

Pi session is JSONL tree with branchable entry history and product-specific entries.

Kernel state is one run snapshot. Branching is caller storage concern.

```ts
import type { AgentRunState } from "@nanoagent/kernel";

type Context = {
  branchId: string;
  threadId: string;
};

declare const runStore: {
  load(runId: string): Promise<AgentRunState<Context>>;
  fork(params: {
    sourceRunId: string;
    atRevision: number;
    branchId: string;
  }): Promise<AgentRunState<Context>>;
};

const forked = await runStore.fork({
  sourceRunId: "run_123",
  atRevision: 14,
  branchId: "branch_checkout_alt",
});
```

Kernel variation: Pi-style JSONL tree, relational branches, event-log replay, immutable checkpoints, or session-per-branch.

### Compaction

Pi compaction is first-class session operation.

Kernel compaction is prompt/context policy.

```ts
import type { AgentHooks, Turn } from "@nanoagent/kernel";

type Context = {
  compactedSummary?: string;
  model: string;
  threadId: string;
};

declare const compactor: {
  shouldCompact(turns: readonly Turn[]): boolean;
  summarize(params: { turns: readonly Turn[] }): Promise<string>;
  messages(params: {
    threadId: string;
    summary?: string;
    turns: readonly Turn[];
  }): Promise<import("ai").ModelMessage[]>;
};

const hooks: AgentHooks<Context> = {
  onTurnPrepared: async ({ context, state }) => ({
    value: {
      model: context.model,
      messages: await compactor.messages({
        threadId: context.threadId,
        summary: context.compactedSummary,
        turns: state.turns,
      }),
    },
  }),
  onTurnCompleted: async ({ context, state }) => {
    if (!compactor.shouldCompact(state.turns)) return;
    return {
      context: {
        ...context,
        compactedSummary: await compactor.summarize({ turns: state.turns }),
      },
    };
  },
};
```

Kernel variation: summarize by tokens, facts, tasks, files, branch deltas, tool outputs, or product-specific memory.

### Extensions

Pi extension packages register hooks, tools, commands, UI, providers, renderers, flags, and shortcuts.

Kernel extension equivalent is composition outside `runAgent`.

```ts
import type {
  AgentHooks,
  AgentMiddlewareMap,
  AgentSaveState,
  JsonLike,
} from "@nanoagent/kernel";
import type { ToolSet } from "ai";

type Plugin<Context extends JsonLike> = {
  tools?: ToolSet;
  hooks?: Partial<AgentHooks<Context>>;
  middleware?: AgentMiddlewareMap<Context>;
  saveState?: AgentSaveState<Context>;
};

declare function composePlugins<Context extends JsonLike>(
  plugins: Plugin<Context>[],
): Plugin<Context>;
```

Kernel variation: reuse `@nanoagent/plugin`, write direct composition, load project-local modules, load MCP tools, or keep host static.

### RPC And Protocol

Pi RPC is concrete JSONL protocol around `AgentSession`.

Kernel can back any protocol.

```ts
import {
  runAgent,
  type AgentHooks,
  type AgentRunState,
  type AgentSaveState,
  type AgentStreamEvent,
} from "@nanoagent/kernel";
import type { ToolSet } from "ai";

type Context = {
  threadId: string;
};

declare const protocol: {
  encode(event: AgentStreamEvent): string;
  write(line: string): Promise<void>;
};
declare const hooks: AgentHooks<Context>;
declare const maxTurns: number;
declare const saveState: AgentSaveState<Context>;
declare const state: AgentRunState<Context>;
declare const tools: ToolSet;

for await (const event of runAgent({ state, hooks, tools, saveState, maxTurns })) {
  await protocol.write(protocol.encode(event));
}
```

Kernel variation: JSONL, SSE, WebSocket, ACP, IDE protocol, test snapshots, trace events, or Pi-compatible event projection.

### Observability

Pi exposes events, session entries, exports, stats, context usage, provider hooks, and HTML export.

Kernel exposes observability through committed phase events, `saveState`, hooks, and middleware.

```ts
import type {
  AgentCallToolArgs,
  AgentMiddleware,
  AgentToolCallResponse,
  JsonLike,
} from "@nanoagent/kernel";

type CallToolMiddleware<Context extends JsonLike> = AgentMiddleware<
  AgentCallToolArgs<Context>,
  AgentToolCallResponse
>;

type Context = {
  threadId: string;
};

declare const metrics: {
  record(name: string, value: number, attributes: Record<string, string>): Promise<void>;
};

const traceTool: CallToolMiddleware<Context> = async ({ input, next }) => {
  const started = performance.now();
  const result = await next(input);

  await metrics.record("agent.tool.ms", performance.now() - started, {
    toolName: input.toolCall.toolName,
  });

  return result;
};
```

Kernel variation: store raw events, project to traces, replay in tests, publish UI timeline, or map onto Pi JSON/RPC event shape.

## Capability Mapping

| Capability | Pi | Nanoagent kernel |
| --- | --- | --- |
| construction | `createAgentSession`, `createAgentSessionRuntime`, `new Agent` | `runAgent({ state, hooks, tools, saveState })` |
| CLI | built-in `pi` | caller-owned wrapper |
| TUI | built-in terminal UI | caller-owned UI |
| RPC | built-in JSONL protocol | caller-owned protocol adapter |
| model | `ModelRegistry`, `Model<any>`, settings, `setModel` | `onTurnPrepared.value.model` |
| provider | `@earendil-works/pi-ai`, `registerProvider`, `models.json` | caller model provider map |
| prompt | context files, skills, templates, extensions | caller-built messages |
| tools | TypeBox `ToolDefinition`, built-ins, extension tools | AI SDK `ToolSet` |
| approvals | extension/tool hooks | hook pause/skip/rewrite |
| sessions | JSONL tree and `SessionManager` | persisted `AgentRunState` |
| branching | `/tree`, `/fork`, `/clone` | caller storage strategy |
| streaming | `AgentEvent` / `AgentSessionEvent` | phase events plus `stream_part` |
| steering | built-in queues | context plus hook control |
| compaction | built-in manual/auto compaction | hook/middleware policy |
| retry | built-in provider retry and auto-retry | middleware and resume policy |
| extensions | Pi extension API | host composition/plugin layer |
| package resources | Pi package manager | caller package/module loader |
| bash | built-in model tool and user command | caller shell tool |
| export | HTML/JSONL session export | caller projection |

## Decision Frame

Use Pi when:

- You want complete coding-agent app.
- Terminal UX, sessions, slash commands, and extensions matter.
- JSON/RPC protocol is enough for non-Node embedding.
- You want provider/model registry and auth flows included.
- You accept Pi-specific tool, session, extension, and resource model.

Use Pi SDK when:

- You build TypeScript/Node app around Pi behavior.
- You need session tree, compaction, prompt resources, and built-in tools.
- You want custom UI around `AgentSession`.
- You can manage runtime object lifecycle and re-subscribe after session replacement.

Use Pi core `Agent` when:

- You want Pi streaming protocol and tool loop without coding-agent app.
- In-memory stateful loop is sufficient.
- You want to own prompt/session/resources but keep Pi agent semantics.

Use nanoagent kernel when:

- You want provider-agnostic durable execution core.
- Product owns UI, protocol, tools, memory, storage, prompt, auth, and resources.
- Checkpointed phase state matters more than built-in app convenience.
- You need to experiment with storage, scheduling, policy, protocol, or tool runtime.
- Same loop must run behind CLI, service, queue, browser, eval, or hosted system.

## Source Links

- [Pi GitHub repository](https://github.com/earendil-works/pi)
- [Pi documentation](https://pi.dev/docs/latest)
- [Pi SDK docs](https://pi.dev/docs/latest/sdk)
- [Pi usage docs](https://pi.dev/docs/latest/usage)
- [Pi RPC docs](https://pi.dev/docs/latest/rpc)
- [Pi extension docs](https://pi.dev/docs/latest/extensions)
- [Pi session docs](https://pi.dev/docs/latest/sessions)
- [Pi models docs](https://pi.dev/docs/latest/models)
- [Pi providers docs](https://pi.dev/docs/latest/providers)
- [Pi compaction docs](https://pi.dev/docs/latest/compaction)
- [Earendil package move post](https://pi.dev/news/2026/5/7/pi-has-a-new-home)
- [Local Pi implementation map](PI_CODING_AGENT_SPEC.md)
- [Kernel API](docs/kernel/api.md)
- [Kernel hooks](docs/kernel/hooks.md)
- [Kernel middleware](docs/kernel/middleware.md)
- [Kernel tools](docs/kernel/tools.md)
- [Kernel state](docs/kernel/state.md)
