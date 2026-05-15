# Kernel Compared To Opinionated Harnesses

Codex, OpenCode, and Pi prove full coding-agent products need more than model
loop. They bundle CLI/TUI modes, session stores, protocol surfaces, tool
registries, permission systems, compaction, retries, auth, settings, and product
policy into one runnable harness.

`@nanoagent/kernel` is smaller on purpose. It owns durable execution sequencing:
phase state, model/tool boundaries, streaming events, commit ordering,
pause/resume, middleware, and cancellation. Caller owns prompt construction,
memory, storage, provider selection, auth, sandboxing, UI, and policy.

## Existing Harnesses

Codex centers on Rust `Session` runtime. CLI, TUI, exec mode, app server, MCP
server, and SDK submit protocol operations into a core session loop that builds
prompts, streams model output, dispatches tools, records rollout items, and
persists thread metadata.

OpenCode centers on TypeScript/Bun services. CLI, TUI, HTTP server, web app,
desktop app, SDK, and ACP adapters route through project instances, Effect
services, Hono APIs, SQLite tables, sync events, and a tool registry assembled
from built-ins, plugins, and MCP.

Pi centers on TypeScript `AgentSession` runtime. CLI/TUI/RPC modes wrap a lower
level agent loop with settings, resource loading, extensions, session JSONL
persistence, compaction, retry, steering, follow-up queues, and mode-specific
rendering.

Those harnesses are useful when desired experiment matches product shape. They
already answer questions like:

- Where sessions live.
- Which protocol carries events.
- How prompts, resources, tools, permissions, compaction, and retries are wired.
- Which UI modes exist.
- How product settings and auth flow into runs.

Those answers become friction when experiment targets one layer. Changing
storage, protocol, permission policy, transcript policy, or tool execution often
means working through product-specific runtime assumptions.

## Vercel AI SDK Agent

Vercel AI SDK `ToolLoopAgent` solves different problem. It is reusable
product-level agent abstraction around `generateText` and `streamText`.

It owns convenient defaults:

- Agent object with `model`, `tools`, `instructions`, `stopWhen`, and
  `prepareStep`.
- Automatic loop over model calls, tool calls, tool results, and final answer.
- Step-level context management through message arrays.
- `generate()` and `stream()` results shaped like AI SDK text generation
  results.
- Stop conditions like `stepCountIs`, `hasToolCall`, and `isLoopFinished`.

That is right abstraction when app wants less loop code. Kernel targets cases
where app needs more loop surface.

`prepareStep` can change model, tools, and messages before each step. Kernel
makes that boundary durable and explicit with `turn_prepared`,
`AgentRunState.currentTurn`, `revision`, and `saveState`.

`stopWhen` decides when agent loop ends. Kernel exposes phase control:
`pause`, `finish`, `continue`, `failed`, and resume from committed phase.

AI SDK Agent handles context management inside agent loop. Kernel keeps context
management caller-owned. `onTurnPrepared` can load model messages from
Postgres, S3, remote transcript storage, inbox queue, compacted summary,
retrieval chunks, or any product-owned source.

AI SDK Agent exposes step callbacks and result objects. Kernel streams durable
phase events plus live `stream_part` events, and every durable phase event is
aligned with committed state revision.

Shortest version:

- `ToolLoopAgent` is convenient agent abstraction.
- `@nanoagent/kernel` is extracted manual agent loop with durable state,
  lifecycle events, and policy checkpoints.

## Kernel Experiment Boundary

Kernel keeps only state machine every harness needs:

```txt
run_started
turn_started
turn_prepared
model_started
model_completed
tool_calls_started
tool_call_started
tool_call_completed
tool_calls_completed
turn_completed
```

Each phase has hook boundary. `onTurnPrepared` supplies exact model call.
Tool hooks can approve, skip, rewrite, pause, or continue. `saveState` receives
revisioned run state at commit boundaries. Stream events go wherever caller
wants: CLI, HTTP, SSE, JSONL, worker queue, notebook, benchmark runner, or test
harness.

This makes kernel useful for experimentation because variables stay outside run
loop:

- Swap prompt assembly without changing tool execution machinery.
- Swap message/session storage without changing phase sequencing.
- Swap provider routing without changing UI or permission code.
- Test permission policies with real pause/resume state.
- Compare tool registries while keeping same durable execution record.
- Run headless benchmarks against same state machine used by product code.
- Reproduce interrupted runs from committed `AgentRunState`.

Kernel does not compete with opinionated harnesses at product layer. It gives
them a smaller shared execution core, and gives experiments a way to isolate
one design choice at a time.

## Practical Difference

With opinionated harness, experiment starts by adopting harness world: session
model, event protocol, storage, config, tool registry, extension surface, and UI
assumptions.

With kernel, experiment starts with caller-owned context and hooks:

```ts
runAgent({
  state,
  hooks: {
    onTurnPrepared: async ({ context }) => ({
      value: {
        model: context.model,
        messages: await messages.load(context.threadId),
      },
    }),
    onToolCallStarted: ({ toolName }) => {
      if (toolName === "DeleteAccount") {
        return { control: { type: "pause", reason: "approval_required" } };
      }
    },
  },
  tools,
  saveState,
  maxTurns: 20,
});
```

Everything around that call is replaceable by experiment. Durable run semantics stay fixed.
