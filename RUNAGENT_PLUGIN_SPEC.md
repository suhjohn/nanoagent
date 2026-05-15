# `runAgent` Plugin Spec

`runAgent` stays execution kernel. `@nanoagent/plugin` provides plugin composition.

Current kernel already exposes right seams in `packages/kernel/src/index.ts`: `state`, `tools`, `modelProviders`, `hooks`, `middleware`, `saveState`, and `signal`. Plugin layer should resolve product behavior into those inputs, then consume `AgentStreamEvent` output.

Kernel owns phase machine, model call boundary, tool call boundary, pause/resume, immutable snapshots, and committed events.

Code above kernel owns product concerns: sessions, persistence, history, prompt assembly, providers, permissions, tools, transports, skills, config, auth, memory, retrieval, compaction, and branch/fork semantics.

## Library Surface

`@nanoagent/kernel` executes. `@nanoagent/plugin` combines options.

Compose intentionally has one real abstraction: option transform.

```ts
export type AgentPlugin<C extends JsonLike> = (
  options: RunAgentOptions<C>,
) => RunAgentOptions<C> | Promise<RunAgentOptions<C>>;
```

Helpers stay mechanical:

- `withPlugins(options, plugins)`.
- `withTools(tools)`.
- `withModelProviders(modelProviders)`.
- `withHooks(hooks)`.
- `withMiddleware(middleware)`.
- `withSaveState(saveState)`.

Layer names below are design vocabulary. They are not required public types.

## Layer Model

Plugin system should describe abstraction levels first, then package shape second.

```txt
surfaces
  CLI, TUI, HTTP, RPC, SSE, JSONL, desktop, web

agent services
  sessions, transcript, prompt, memory, retrieval, compaction, branch/fork

runtime host
  plugin graph, config, auth lookup, service container, composition, event fanout

runAgent kernel
  phase machine, model/tool boundaries, pause/resume, state commits

boundary drivers
  model providers, tools, persistence stores, sandbox, approval transport

external systems
  model APIs, filesystem, shell, MCP servers, databases, browsers
```

Layers describe dependency direction.

Surfaces depend on runtime host. Runtime host depends on kernel and driver/service interfaces. Kernel depends only on typed callbacks passed in through `RunAgentOptions`. Drivers depend on external systems. Agent services coordinate policy and state, but enter kernel only through hooks, middleware, `state`, and `saveState`.

No lower layer imports higher layer. Kernel does not import TUI, API, session store, prompt builder, tool packages, provider packages, or plugin host.

## Abstraction Boundaries

### Protocol Layer

Protocol layer is shared vocabulary: `AgentRunState`, `AgentPhaseEvent`, `AgentStreamEvent`, `AgentToolCall`, `AgentToolCallResponse`, `AgentModelResult`, `JsonLike`, and durable tool result schemas.

Protocol types must stay JSON-clean where persisted or emitted. Raw SDK/provider/process handles stay outside protocol.

### Kernel Layer

Kernel executes one deterministic run state machine.

Allowed kernel concepts:

- Run status and phase.
- Turn state.
- Model call boundary.
- Tool call boundary.
- Hook and middleware execution.
- Snapshot commit.
- Pause, finish, continue, fail.

Disallowed kernel concepts:

- Filesystem behavior.
- Shell behavior.
- MCP.
- Skills.
- Config files.
- CLI flags.
- HTTP, SSE, RPC, TUI.
- Session names.
- Branch trees.
- Memory stores.
- Provider package imports.

### Runtime Host Layer

Runtime host is userland supervisor for agent execution.

It loads config, resolves plugin graph, initializes services, builds tool registry, builds model provider registry, composes hooks/middleware, loads initial state, calls `runAgent`, and publishes events after commit.

Runtime host is only place that sees whole application.

### Boundary Driver Layer

Drivers adapt external systems into kernel callbacks.

Provider drivers expose AI SDK-compatible model factories. Tool drivers expose model-visible definitions and executable handlers. Persistence drivers expose `loadRun` and `saveState`. Sandbox and approval drivers mediate side effects before execution.

Driver output must normalize into protocol types before crossing into durable state or event stream.

### Agent Service Layer

Agent services implement product semantics.

Session service owns run creation, resume, transcript projection, session metadata, import/export/delete, and branch/fork graph.

Prompt service owns instructions, memory, retrieval, history projection, context budgeting, and compaction.

Policy service owns permissions, model routing, tool visibility, retries, and failure recovery.

Services are not kernel modules. They contribute hooks, middleware, state loaders, and event handlers through runtime host.

### Surface Layer

Surfaces present controls and consume events.

TUI, API, RPC, SSE, JSONL, and web adapters should never reach into kernel internals. They start runs, send abort/resume/permission replies through host controls, and render/publish event stream.

Surface adapters can persist their own live stream deltas, but authoritative run history comes from committed phase events and projections.

## Plugin Kinds

Plugin packages can contribute to one layer or several adjacent layers, but spec should name contribution kind.

```ts
export type AgentPluginKind =
  | "driver"
  | "service"
  | "surface"
  | "policy"
  | "config";
```

`driver` plugins touch external systems. `service` plugins shape session/prompt/agent semantics. `surface` plugins expose user interfaces or protocols. `policy` plugins gate behavior across drivers. `config` plugins add schema, env, and CLI bindings.

Mixed plugins are allowed only when coupling is real. Example: `@nano/tools-shell` can include driver plus policy defaults. `@nano/surfaces-api` should not include prompt assembly.

## Core Shape

Plugin interface should be small. Plugin contributes one or more capability groups. Host resolves graph, validates config, creates services, then builds one `RunAgentOptions`.

```ts
import type { Schema } from "effect";
import type {
  AgentHooks,
  AgentMiddlewareMap,
  AgentModelProviders,
  AgentRunState,
  AgentSaveState,
  AgentStreamEvent,
  JsonLike,
  RunAgentOptions,
} from "./index";
import type { ToolSet } from "ai";

export type AgentPlugin<C extends JsonLike, P extends JsonLike = JsonLike> = {
  name: string;
  kind: AgentPluginKind | readonly AgentPluginKind[];
  order?: number;
  requires?: readonly string[];
  config?: Schema.Schema<P>;
  setup: (host: AgentPluginHost<C, P>) => AgentPluginContribution<C>;
};

export type AgentPluginContribution<C extends JsonLike> = {
  modelProviders?: AgentModelProviders;
  tools?: ToolSet | ((ctx: ToolRegistryContext<C>) => AgentEffectResult<ToolSet>);
  hooks?: Partial<AgentHooks<C>>;
  middleware?: Partial<AgentMiddlewareMap<C>>;
  saveState?: SaveStateMiddleware<C>;
  eventAdapters?: readonly AgentEventAdapter<C>[];
  commands?: readonly CommandSource[];
  skills?: readonly SkillSource[];
  auth?: readonly AuthProvider[];
  config?: ConfigSurface;
};

export type SaveStateMiddleware<C extends JsonLike> = (
  args: Parameters<AgentSaveState<C>>[0],
  next: AgentSaveState<C>,
) => AgentEffectResult<void>;

export type AgentEventAdapter<C extends JsonLike> = {
  name: string;
  publish: (args: {
    event: AgentStreamEvent;
    state: Readonly<AgentRunState<C>>;
  }) => AgentEffectResult<void>;
};
```

## Contribution Rules

Plugin kind constrains contribution shape. Host validates these rules at load time.

`driver` may contribute `modelProviders`, `tools`, driver middleware, and `saveState` adapters. It may depend on host services for credentials, logging, clocks, and durable stores. It must not depend on surface state or UI protocol types.

`service` may contribute hooks, middleware, state loaders, projectors, commands, and event handlers. It may depend on protocol types and driver interfaces. It must not import concrete TUI/API/server packages.

`policy` may contribute middleware and hooks that gate behavior. It runs before side-effecting drivers. It must return allow/deny/pause/rewrite decisions before driver execution begins.

`surface` may contribute event adapters, command handlers, and control endpoints. It may start/resume/abort runs through host APIs. It must not mutate `AgentRunState` directly.

`config` may contribute schemas, defaults, env bindings, and CLI flags. It validates inputs before plugin setup. It must not call model providers, tools, or persistence directly.

Cross-layer dependency points should be explicit host services:

```ts
export type AgentPluginHost<C extends JsonLike, P extends JsonLike> = {
  plugin: { name: string; kind: readonly AgentPluginKind[]; config: P };
  services: AgentHostServices;
  protocol: AgentProtocolVersion;
  registerDiagnostic: (diagnostic: PluginDiagnostic) => void;
};
```

Host services are process-local handles. They never enter `context`, model messages, tool output, or events.

No plugin calls `runAgent` directly. Host calls `runAgent` once with composed options.

```ts
const options = composeRunAgent({
  plugins: [
    persistencePlugin,
    historyPlugin,
    compactionPlugin,
    providerPlugin,
    filesystemPlugin,
    shellPlugin,
    permissionsPlugin,
    ssePlugin,
  ],
  state,
  maxTurns,
  hooks,
  saveState,
  middleware,
});

for await (const event of runAgent(options)) {
  await adapters.publish({ event, state: options.state });
}
```

## Composition Lifecycle

Plugin behavior must be deterministic and inspectable.

1. Load config.
2. Resolve plugin dependency graph.
3. Initialize host services.
4. Load or create `AgentRunState`.
5. Merge model providers.
6. Merge tool definitions.
7. Compose hooks in plugin order.
8. Compose middleware in plugin order.
9. Compose `saveState` middleware around durable store.
10. Run `runAgent`.
11. Fan out events after snapshot commit.
12. Close plugins.

Hook composition feeds updated `context` and `value` into next hook. First `pause` or `finish` control wins.

Middleware composition preserves current kernel shape: `callModel` and `callTool` remain ordered arrays.

`saveState` composition is commit barrier. Persistence plugins must write `state + events` atomically before event adapters publish.

## Dependency Direction

Layer dependency rules keep abstractions clean:

- `surface -> runtime host -> kernel`
- `surface -> agent services -> protocol`
- `agent services -> boundary driver interfaces`
- `boundary drivers -> external systems`
- `kernel -> protocol`

Forbidden imports:

- Kernel importing host, plugins, tools, providers, config, surfaces, or product services.
- Driver importing surface.
- Service importing concrete surface.
- Surface importing concrete driver internals.
- Plugin importing another plugin's private files.

Shared communication goes through protocol types, host services, hooks, middleware, commands, and event adapters.

## Session Plugins

Session behavior lives outside kernel. Kernel sees only `AgentRunState` and `saveState`.

### `persistencePlugin`

Owns durable snapshot store, revision compare-and-swap, append-only `AgentPhaseEvent` log, projections, and transaction boundary.

`saveState` writes snapshot and phase events in same transaction. Event adapters publish after commit.

### `historyPlugin`

Owns transcript schema and prompt projection.

It reads committed turns and returns exact `messages` from `onTurnPrepared`. It records assistant/tool output from committed `turn_completed` events, not stream deltas.

### `compactionPlugin`

Owns token accounting, summary model, compacted-history projection, and manual compact command.

Compaction writes summary entries referencing source revision and first kept entry. Raw history stays intact for fork, audit, export, and branch views.

Context overflow should route to explicit recovery hook. Plugin compacts, commits compaction, then reruns turn preparation.

### `branchPlugin`

Owns fork tree and copy-on-write branch selection.

Fork creates new run state from selected transcript prefix with parent edge metadata. Parent transcript is never rewritten.

## Model And Context Plugins

`onTurnPrepared` is currently one large boundary. Plugin layer should split it into reducers before rendering final `AgentTurnPreparedValue`.

```ts
export type PromptDraft = {
  model?: string;
  options: AgentStreamTextOptions;
  fragments: PromptFragment[];
  messages: ModelMessage[];
  tokenBudget?: number;
};

export type PromptPlugin<C extends JsonLike> = {
  selectModel?: PromptReducer<C>;
  buildPrompt?: PromptReducer<C>;
  compact?: PromptReducer<C>;
  renderPrompt?: PromptRenderer<C>;
};
```

Recommended order:

1. Provider plugins register provider factories and model metadata.
2. Model policy plugin selects model and options.
3. Instruction plugins add system, developer, user, environment fragments.
4. Memory plugin reads durable memories.
5. Retrieval plugin resolves files/resources/search results with provenance.
6. History plugin projects prior turns.
7. Compaction plugin rewrites prompt draft when over budget.
8. Renderer converts draft to exact model args.
9. Model middleware wraps `streamText` with retry, tracing, auth, redaction.
10. Completion hooks record usage, warnings, sources, memory updates.

Provider plugins own auth, headers, model metadata, context limits, and provider-specific options. Kernel should not import every provider package.

Memory writes happen after durable turn commit. Failed, paused, or aborted work must not pollute future context.

## Tool Plugins

Tool plugins should separate model-visible definition from executable handler.

```ts
export type AgentTool<C extends JsonLike> = {
  definition: Omit<ToolSet[string], "execute">;
  policy?: (args: ToolPolicyArgs<C>) => AgentEffectResult<ToolPolicy>;
  execute: (args: ToolExecutionArgs<C>) => AgentEffectResult<ToolResult>;
  normalize?: (result: ToolResult) => AgentToolCallResponse;
  concurrency?: "parallel" | "serial" | { group: string };
  visible?: (ctx: ToolRegistryContext<C>) => boolean;
};
```

Tool registry order:

1. Register plugin tools.
2. Namespace and validate tool names.
3. Reject collisions.
4. Apply model, provider, session, and permission visibility.
5. Strip `execute` before model call.
6. Route tool calls by stable reverse map.
7. Run tool middleware.
8. Normalize result into durable shape.

Tool middleware order:

```ts
callTool: [
  replayMiddleware,
  schemaMiddleware,
  permissionMiddleware,
  approvalMiddleware,
  sandboxMiddleware,
  concurrencyMiddleware,
  pluginBeforeAfterMiddleware,
  normalizationMiddleware,
]
```

Current kernel executes launched tool calls with unbounded concurrency. Plugin layer needs serial groups for filesystem mutation, patch application, and process/session tools.

### Baseline Tool Plugins

`shellPlugin` owns process manager, PTY sessions, stdin routing, timeout, output truncation, env, cwd, and sandbox envelope.

`filesystemPlugin` owns read/write/glob/grep, path policy, file metadata, and output limits.

`applyPatchPlugin` owns patch parser, patch application, touched-file policy, and changed-file events.

`mcpPlugin` owns server registry, OAuth, elicitation, namespaced server tools, reverse mapping, resources, and content normalization.

`permissionPlugin` owns allow/deny/prompt/elevate decisions before side effects.

`sandboxPlugin` owns isolation policy and execution envelope. Tool implementation declares capability; policy plugin decides execution mode.

### Tool Result Shape

Durable state should avoid `unknown` output/error for plugin-owned tools.

```ts
export type ToolResult =
  | {
      ok: true;
      model: JsonLike | string;
      display?: JsonLike;
      artifacts?: JsonLike;
    }
  | {
      ok: false;
      error: SerializedError;
      recoverable: boolean;
      display?: JsonLike;
    };
```

Model-visible content and UI artifacts stay separate. Raw handles, streams, buffers, secrets, and process objects never enter `context` or events.

## Surface Plugins

Surface plugins consume events and provide controls. They do not mutate kernel internals.

`jsonlAdapter` writes every event for debugging and replay.

`sseAdapter` emits event stream with heartbeat. Durable phase events use `revision`; live `stream_part` gets adapter sequence.

`rpcAdapter` maps protocol commands to run start, abort, resume, state read, and permission reply.

`tuiAdapter` renders stream parts, tool states, pause prompts, and errors.

`apiAdapter` exposes run/session endpoints.

`busAdapter` publishes typed internal events for app listeners.

Persist only `AgentPhaseEvent` through `saveState`. `stream_part` is live transport unless specific adapter stores deltas for resumable streaming.

## Config, Auth, Skills, Commands

Config plugins contribute schemas, CLI flags, env bindings, defaults, and validation.

Auth plugins expose credentials to provider factories and boundary middleware. Secrets stay in host services and never appear in events or context.

Skills and slash commands compile into prompt fragments, tool visibility, or surface commands. They do not become kernel concepts.

## Kernel Additions Worth Making

Keep additions narrow. Make plugin host easier without moving product behavior into kernel.

### `onSnapshotCommitted`

Fire after `saveState`, before event yield. Lets adapters publish only committed events.

### `onEvent`

Observe `stream_part` and phase events in one place. No state mutation.

### `onRunResumed`

Fire after paused snapshot returns to running. Needed for session and surface plugins.

### `onModelError` Or `onContextOverflow`

Let compaction handle provider context-length failure and retry same turn cleanly.

### Dynamic Tool Resolver

Current `tools` are captured once. Dynamic tools need either run pause/re-entry with updated tool registry, or kernel-level per-turn tool resolver.

```ts
tools?: ToolSet | ((args: ToolRegistryContext<C>) => AgentEffectResult<ToolSet>);
```

### Tool Concurrency

Current execution is unbounded. Add execution mode to tool calls or tool definitions.

```ts
type ToolConcurrency = "parallel" | "serial" | { group: string };
```

Filesystem writes and patch operations should use serial group.

## Plugin Categories

Common user-level capabilities map cleanly to plugin packages:

- `@nano/session`: `service` plus persistence `driver`; history, transcript projection, resume.
- `@nano/branch`: `service`; fork tree, branch summaries, copy-on-write sessions.
- `@nano/compact`: `service`; summarization, token accounting, context overflow recovery.
- `@nano/providers`: `driver`; provider registry, model metadata, auth, retry.
- `@nano/prompt`: `service`; instructions, memories, retrieval, prompt rendering.
- `@nano/tools-shell`: `driver`; shell, PTY, process lifecycle.
- `@nano/tools-fs`: `driver`; read/write/glob/grep/path policy.
- `@nano/tools-patch`: `driver`; apply patch and changed-file metadata.
- `@nano/mcp`: `driver`; MCP servers, resources, remote tools, OAuth.
- `@nano/permissions`: `policy`; approval prompts, sandbox policy, capability checks.
- `@nano/surfaces-tui`: `surface`; terminal rendering and controls.
- `@nano/surfaces-api`: `surface`; HTTP/RPC/SSE transport.
- `@nano/config`: `config`; config files, env, CLI flags, schema validation.
- `@nano/skills`: `service`; skill discovery and prompt/tool integration.

## Non-Negotiables

Plugin order is behavior. Make resolved order visible in diagnostics.

Plugin context must be namespaced and versioned. Collisions break resume.

Commit before publish. Event consumers must never see uncommitted phase events.

Permissions happen before side effects.

Compaction is projection, not deletion.

Branching is copy-on-write.

Provider secrets never enter events, context, tool output, or model-visible prompt.

Tool output must be bounded, JSON-clean, and split between model and display.

Kernel does not learn TUI, CLI, RPC, API, SSE, filesystem, shell, MCP, skills, or product-specific session semantics.
