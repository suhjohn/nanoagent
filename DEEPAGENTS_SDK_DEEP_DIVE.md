# DeepAgents SDK Deep Dive

DeepAgents is LangChain agent harness around LangChain and LangGraph primitives.

It wraps LangChain `createAgent` ergonomics with built-in planning, filesystem state, subagents, memory, permissions, streaming, and deployment hooks. Caller still owns model selection, tools, schemas, persistence boundaries, approval policy, and UI behavior.

Checked May 20, 2026:

- npm `deepagents@1.10.2`
- PyPI `deepagents@0.6.2`
- LangChain docs under `docs.langchain.com/oss/javascript/deepagents`

## Supported Surfaces

DeepAgents exposes five caller-facing surfaces.

- TypeScript SDK: `deepagents` npm package, primary surface for LangChain JS apps
- Python SDK: `deepagents` PyPI package, parallel surface for LangChain Python apps
- Deep Agents Code: `dcode` terminal coding agent built on SDK
- Protocol adapters: ACP and MCP integration points
- LangSmith deployment: managed Deep Agents and LangGraph runtime hosting path

TypeScript SDK matters most for JS callers. It accepts LangChain tools, LangChain chat models, LangChain middleware, LangGraph persistence, LangGraph stores, and LangGraph streaming.

Examples use `declare const` for caller-owned services, tools, stores, and emitters. Those names mark app boundaries rather than DeepAgents or kernel exports.

## TypeScript SDK Shape

`createDeepAgent` is primary constructor.

```ts
import { createDeepAgent } from "deepagents";
import { tool } from "langchain";
import { z } from "zod";

declare const issueStore: {
  search(params: { query: string }): Promise<Array<{ id: string; title: string }>>;
};

const searchIssues = tool(
  async ({ query }: { query: string }) => {
    return await issueStore.search({ query });
  },
  {
    name: "search_issues",
    description: "Search issue tracker for matching work items.",
    schema: z.object({
      query: z.string(),
    }),
  },
);

const agent = createDeepAgent({
  model: "openai:gpt-5.4",
  tools: [searchIssues],
  systemPrompt: "You triage engineering work.",
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "Find auth bugs and propose fix order." }],
});
```

Caller experience is familiar if app already uses LangChain JS. Tools use `tool()`, schemas use Zod, model strings use `provider:model`, and execution uses normal runnable methods like `invoke`, `stream`, and `streamEvents`.

## Constructor Options

Current TypeScript declaration exposes this practical shape:

```ts
createDeepAgent({
  model,
  tools,
  systemPrompt,
  middleware,
  subagents,
  responseFormat,
  contextSchema,
  checkpointer,
  store,
  backend,
  interruptOn,
  name,
  memory,
  skills,
  permissions,
  streamTransformers,
});
```

Each option maps to existing LangChain or LangGraph concept.

`model` accepts `provider:model` string or configured LangChain model instance. String path is concise. Model instance path gives caller full provider-specific parameter control.

`tools` accepts LangChain tools. This keeps tool authoring normal: typed input schema, stable name, useful description, async implementation.

`systemPrompt` extends built-in DeepAgents harness prompt. Caller supplies product-specific instructions, while SDK keeps planning and context-management prompt.

`middleware` accepts LangChain `AgentMiddleware`. Runtime model routing, guardrails, tracing decoration, tool rewriting, and context shaping use same middleware concepts as LangChain agents.

`subagents` accepts inline subagent specs, compiled LangChain/LangGraph runnables, and async Agent Protocol subagents.

`responseFormat` follows LangChain structured output support. Zod schemas and LangChain response strategies fit here.

`checkpointer` persists agent state across invocations. Human approval workflows require checkpointer.

`store` persists long-term memory through LangGraph store APIs.

`backend` controls virtual filesystem. Caller chooses in-memory state, local files, durable store, sandbox, or custom backend.

`interruptOn` configures human approval per tool name.

`memory` loads AGENTS-style instruction files into system prompt.

`skills` loads reusable `SKILL.md` instruction bundles.

`permissions` applies filesystem access policy to built-in filesystem tools.

`streamTransformers` lets caller add event projections on top of built-in subagent projection.

## Model Ergonomics

Model path is low ceremony.

```ts
const agent = createDeepAgent({
  model: "anthropic:claude-sonnet-4-6",
});
```

Any LangChain chat model that supports tool calling works. DeepAgents docs list examples across Google, OpenAI, Anthropic, OpenRouter, Fireworks, Baseten, and Ollama.

Configured model path gives caller direct provider parameter control.

```ts
import { initChatModel } from "langchain/chat_models/universal";
import { createDeepAgent } from "deepagents";

const model = await initChatModel("google_genai:gemini-3.1-pro-preview", {
  reasoningEffort: "medium",
});

const agent = createDeepAgent({ model });
```

Runtime model selection belongs in middleware.

```ts
import { createMiddleware } from "langchain";
import { createDeepAgent } from "deepagents";
import { z } from "zod";
import { initChatModel } from "langchain/chat_models/universal";

const contextSchema = z.object({
  model: z.string(),
});

const configurableModel = createMiddleware({
  name: "ConfigurableModel",
  wrapModelCall: async (request, handler) => {
    const model = await initChatModel(request.runtime.context.model);
    return handler({ ...request, model });
  },
});

const agent = createDeepAgent({
  model: "openai:gpt-5.4",
  contextSchema,
  middleware: [configurableModel],
});
```

Ergonomic read: demos use strings; production apps pass model instances or route through middleware.

## Tool Ergonomics

Tool API is LangChain-native. Caller writes normal `tool()` functions, then DeepAgents adds planning, filesystem, and delegation tools around them.

```ts
import { tool } from "langchain";
import { z } from "zod";

declare const ticketStore: {
  create(params: {
    title: string;
    body: string;
    priority: "low" | "medium" | "high";
  }): Promise<{ id: string; url: string }>;
};

const createTicket = tool(
  async ({ title, body, priority }: {
    title: string;
    body: string;
    priority: "low" | "medium" | "high";
  }) => {
    return await ticketStore.create({ title, body, priority });
  },
  {
    name: "create_ticket",
    description: "Create ticket in issue tracker.",
    schema: z.object({
      title: z.string(),
      body: z.string(),
      priority: z.enum(["low", "medium", "high"]),
    }),
  },
);
```

Caller experience depends on tool names and schemas. Harness gives model more time and memory. Tool contracts still decide reliability.

Built-in SDK tools include:

- `write_todos`
- `ls`
- `read_file`
- `write_file`
- `edit_file`
- `glob`
- `grep`
- `execute`, when backend supports shell execution
- `task`, when subagents are configured
- async task tools, when async subagents are configured

## Structured Output

DeepAgents inherits LangChain structured output ergonomics through `responseFormat`.

```ts
const agent = createDeepAgent({
  responseFormat: z.object({
    summary: z.string(),
    risks: z.array(z.string()),
    nextActions: z.array(z.string()),
  }),
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "Review current incident notes." }],
});

result.structuredResponse;
```

Caller-facing benefit is clean boundary at app edge. Agent can use files, subagents, and tools internally, then return typed product result.

Use structured output for product workflows. Avoid relying on final assistant prose when downstream code needs fields.

## Filesystem Backend Ergonomics

DeepAgents filesystem is virtualized. Caller chooses storage semantics.

Built-in TypeScript exports:

- `StateBackend`
- `StoreBackend`
- `FilesystemBackend`
- `LocalShellBackend`
- `CompositeBackend`
- `ContextHubBackend`
- `BaseSandbox`
- `LangSmithSandbox`

Backend contract covers file-like operations:

```ts
interface BackendProtocolV2 {
  ls(path: string): MaybePromise<LsResult>;
  read(filePath: string, offset?: number, limit?: number): MaybePromise<ReadResult>;
  readRaw(filePath: string): MaybePromise<ReadRawResult>;
  grep(pattern: string, path?: string | null, glob?: string | null): MaybePromise<GrepResult>;
  glob(pattern: string, path?: string): MaybePromise<GlobResult>;
  write(filePath: string, content: string): MaybePromise<WriteResult>;
  edit(filePath: string, oldString: string, newString: string, replaceAll?: boolean): MaybePromise<EditResult>;
}
```

Sandbox backend adds shell execution:

```ts
interface SandboxBackendProtocolV2 extends BackendProtocolV2 {
  execute(command: string): MaybePromise<ExecuteResponse>;
  readonly id: string;
}
```

Ergonomic read:

- `StateBackend`: lowest setup, ephemeral per run
- `StoreBackend`: cross-thread memory through LangGraph store
- `FilesystemBackend`: local project agents
- `LocalShellBackend`: host shell execution when caller intends local process access
- `CompositeBackend`: routes paths to different storage providers
- `LangSmithSandbox`: remote execution and isolation through LangSmith

Custom backend is clean extension point. Caller implements file operations once, then built-in tools automatically work.

## Permissions

Permissions apply to built-in filesystem tools.

```ts
const agent = createDeepAgent({
  permissions: [
    { operations: ["read"], paths: ["/workspace/**"] },
    { operations: ["write"], paths: ["/workspace/reports/**"] },
    { operations: ["read", "write"], paths: ["/secrets/**"], mode: "deny" },
  ],
});
```

Caller ergonomics are declarative for files. Policy is less complete for custom tools, MCP tools, and shell execution. Those require caller-owned checks inside tool code, middleware, sandbox policy, or HITL.

## Human Approval

`interruptOn` configures approval at tool boundary.

```ts
import { MemorySaver } from "@langchain/langgraph";

const agent = createDeepAgent({
  tools: [sendEmail, deleteRecord],
  checkpointer: new MemorySaver(),
  interruptOn: {
    send_email: true,
    delete_record: {
      allowedDecisions: ["approve", "reject"],
    },
  },
});
```

Caller must persist thread state and resume with same thread ID. That creates more ceremony than simple `invoke`, but matches LangGraph interrupt semantics and enables real approval UI.

Ergonomic read: approval fits apps with thread/session state. Stateless request-response handlers need added resume storage.

## Subagents

Subagents use `task` tool. Main agent delegates work while preserving main context.

```ts
import type { StructuredTool } from "@langchain/core/tools";

declare const readRepoFile: StructuredTool;
declare const searchRepo: StructuredTool;

const agent = createDeepAgent({
  subagents: [
    {
      name: "code_reviewer",
      description: "Review TypeScript diffs for correctness, typing, and maintainability.",
      systemPrompt: "You review code. Return concrete findings with file and line.",
      tools: [readRepoFile, searchRepo],
      model: "anthropic:claude-sonnet-4-6",
    },
  ],
});
```

Subagent spec supports:

- `name`
- `description`
- `systemPrompt`
- `tools`
- `model`
- `middleware`
- `interruptOn`
- `skills`
- `responseFormat`
- `permissions`

Compiled subagents accept existing runnable:

```ts
declare const agentToken: string;
declare const graphServerUrl: string;

const agent = createDeepAgent({
  subagents: [
    {
      name: "existing_triage_agent",
      description: "Use existing triage graph.",
      runnable: triageGraph,
    },
  ],
});
```

Ergonomic read: inline subagents are concise. Compiled subagents fit organizations that already have LangGraph agents. Permission replacement per subagent isolates sensitive capabilities.

## Async Subagents

Async subagents use Agent Protocol-backed workers. Parent agent starts task, checks status, updates task, cancels task, or lists tasks.

```ts
const agent = createDeepAgent({
  subagents: [
    {
      name: "deep_research",
      description: "Run long research task outside main agent loop.",
      graphId: "research_agent",
      url: graphServerUrl,
      headers: { Authorization: `Bearer ${agentToken}` },
    },
  ],
});
```

Caller ergonomics are different from sync subagents:

- long-running work
- remote workers
- independent scaling
- more deployment ceremony
- more status handling

Use async subagents when work naturally outlives current agent turn or runs on separate infrastructure.

## Memory

DeepAgents memory has two shapes.

`memory` loads instruction files into prompt:

```ts
const agent = createDeepAgent({
  memory: ["./AGENTS.md", "./team/AGENTS.md"],
});
```

LangGraph `store` persists data across conversations:

```ts
const agent = createDeepAgent({
  store,
});
```

Caller ergonomics are split cleanly:

- instruction memory: markdown files for project conventions
- data memory: LangGraph store for durable user or workspace facts

Keep product state requiring correctness in store or app database.

## Skills

Skills are markdown-backed capability bundles.

```ts
const agent = createDeepAgent({
  backend: new FilesystemBackend({ rootDir: "/home/app/.deepagents" }),
  skills: ["/skills/"],
});
```

Skill directories contain `SKILL.md` with metadata and instructions. DeepAgents loads relevant instructions through skills middleware.

Caller ergonomics are strong for reusable procedures, coding conventions, research playbooks, and domain-specific operating instructions. They are weak for executable product logic. Keep product logic in tools and services.

Custom subagents inherit no main-agent skills, aside from documented general-purpose subagent behavior. Set `skills` directly on specialized subagents when they need their own capability set.

## Streaming

DeepAgents supports normal LangGraph/LangChain streaming plus DeepAgents event projections.

Caller options:

- `stream` for incremental agent output
- `streamEvents` for tool calls, subagent events, state transitions, and UI timelines
- custom `streamTransformers` for app-specific event projections

Ergonomic read: `invoke` is fine for backend jobs. Product UI needs `streamEvents`, otherwise caller loses visibility into planning, file operations, and subagent work.

## Interpreter

Interpreter support comes through `@langchain/quickjs`.

```ts
import { createDeepAgent } from "deepagents";
import { createCodeInterpreterMiddleware } from "@langchain/quickjs";

const agent = createDeepAgent({
  middleware: [createCodeInterpreterMiddleware()],
});
```

This gives agent in-memory JavaScript execution without full shell access. Caller gets safer tool composition and data transformation than unrestricted shell, with less operational load than remote sandbox.

Use interpreter for calculations, JSON reshaping, tool orchestration, and small code execution. Use sandbox backend for builds, tests, package installs, or filesystem-heavy execution.

## MCP Ergonomics

MCP tools enter through LangChain MCP adapters, then become ordinary tools for DeepAgents.

Caller path:

```ts
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { createDeepAgent } from "deepagents";

const client = new MultiServerMCPClient({
  servers: {
    docs: {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@langchain/docs-mcp"],
    },
  },
});

const tools = await client.getTools();
const agent = createDeepAgent({ tools });
```

Ergonomic read: MCP brings external tools into agent. DeepAgents treats MCP tools like other tools, so approval, permissions, and errors need caller attention. Filesystem permissions do not automatically constrain MCP server behavior.

## ACP Ergonomics

ACP exposes agent over Agent Client Protocol, mainly for editors and agent clients.

Deep Agents Code can run ACP server mode:

```bash
dcode --acp
```

Caller perspective shifts from library integration to process/protocol integration. App or editor speaks protocol, agent owns interactive execution.

Use ACP when product already expects agent server process, editor integration, or protocol-level agent exchange. Use TypeScript SDK when app needs direct function calls and in-process tools.

## Python SDK

Python package mirrors same harness idea.

```python
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="openai:gpt-5.4",
    tools=[search_issues],
    system_prompt="You triage engineering work.",
)

result = agent.invoke({
    "messages": [{"role": "user", "content": "Find auth bugs and propose fix order."}]
})
```

Python fits Python-first tools, app servers, and data stacks. JS fits TypeScript-first backends, frontend streaming layers, and existing LangChain JS apps.

Keep one SDK inside request path unless process boundary is deliberate. If Python owns data tools, expose them through MCP, HTTP, or async subagent protocol to JS DeepAgents app.

## Deep Agents Code

`dcode` is terminal coding agent built on SDK.

Install path from docs:

```bash
curl -LsSf https://langch.in/dcode | bash
dcode
```

Caller ergonomics are CLI-first:

- interactive terminal session
- non-interactive `-n`
- stdin piping
- model switching
- skills and memory under `~/.deepagents`
- shell allow list for non-interactive runs
- MCP config loading
- remote sandbox options
- ACP server mode

Examples:

```bash
dcode -n "Review this diff" < diff.patch
dcode -n "Run tests and fix failures" -S "pytest,git,make"
dcode --model anthropic:claude-opus-4-7
dcode --acp
```

Use `dcode` as reference implementation. It shows SDK concepts in full caller experience: approvals, shell, memory, skills, tracing, sessions, MCP, and streaming UI.

## Deployment

LangSmith is preferred managed path. DeepAgents builds on LangGraph runtime, so deployment follows LangGraph/LangSmith patterns.

Caller choices:

- in-process SDK inside app backend
- Deep Agents Code CLI for local automation
- remote sandbox for execution isolation
- async subagent graph server
- managed LangSmith deployment
- ACP server for editor/client integration

Ergonomic tradeoff is ownership. In-process SDK gives tight app integration and direct tool access. Managed/runtime deployment gives isolation, scaling, and observability, but caller must treat agent as service.

## Caller Ergonomics Summary

DeepAgents is ergonomic when caller already accepts LangChain/LangGraph mental model.

Strong parts:

- one constructor for complex agent harness
- normal LangChain tool authoring
- normal LangChain model strings and model instances
- strong TypeScript inference for middleware, subagents, response format
- built-in filesystem and planning tools
- built-in subagent delegation
- pluggable backends
- direct path to HITL and streaming UI
- skills and memory as file-backed operational layer

Sharp parts:

- tool quality still determines agent quality
- approvals require checkpointer and thread resume discipline
- filesystem permissions do not secure arbitrary custom or MCP tool behavior
- shell execution requires sandbox or strict allow-listing
- async subagents add deployment surface
- streaming UI needs event handling beyond final messages
- model support depends on tool-calling quality as much as API availability

## Recommended JS App Shape

Use this shape for product integration:

```ts
const agent = createDeepAgent({
  name: "workspace_agent",
  model,
  tools: productTools,
  systemPrompt: workspacePrompt,
  contextSchema,
  checkpointer,
  store,
  backend,
  permissions,
  interruptOn: sensitiveToolPolicy,
  subagents: [
    codeReviewAgent,
    researchAgent,
    dataAnalysisAgent,
  ],
  responseFormat: outputSchema,
});
```

Keep responsibilities crisp.

- product services own data mutations
- tools expose narrow capabilities
- DeepAgents owns planning and orchestration
- backend owns agent working files
- store owns durable agent memory
- checkpointer owns resumable execution
- UI consumes `streamEvents`
- permission/HITL policy sits near tool risk

## Nanoagent Kernel Comparison

Kernel expresses DeepAgents functionality as durable loop composition.

DeepAgents ships opinionated harness. Nanoagent kernel ships one state machine:
`runAgent({ state, hooks, tools, modelProviders, middleware, saveState, signal, maxTurns })`.
Caller owns prompts, memory, filesystem, protocols, approvals, storage,
sandboxing, and product policy.

That is more flexible when product needs different boundaries. Same feature can
live in hooks, tools, middleware, state context, external services, or wrapper
factories.

### Agent Construction

DeepAgents:

```ts
const agent = createDeepAgent({
  model,
  tools,
  systemPrompt,
  backend,
  subagents,
  interruptOn,
});
```

Kernel:

```ts
import {
  runAgent,
  type AgentHooks,
  type AgentMiddlewareMap,
  type AgentModelProviders,
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
declare const middleware: AgentMiddlewareMap<Context>;
declare const modelProviders: AgentModelProviders;
declare const saveState: AgentSaveState<Context>;
declare const state: AgentRunState<Context> | { context: Context };
declare const tools: ToolSet;

for await (const event of runAgent<Context>({
  state,
  hooks,
  tools,
  modelProviders,
  middleware,
  saveState,
  maxTurns: 20,
})) {
  await emit(event);
}
```

Kernel variant: build product wrapper without hiding runtime boundary.

```ts
function runWorkspaceAgent(params: {
  emit(event: AgentStreamEvent): Promise<void>;
  state: AgentRunState<Context> | { runId?: string; context: Context };
}) {
  return runAgent<Context>({
    state: params.state,
    hooks: workspaceHooks,
    tools: workspaceTools,
    modelProviders,
    middleware,
    saveState,
    maxTurns: 20,
  });
}
```

Caller ergonomics differ. DeepAgents gives agent object. Kernel gives resumable
execution function. Wrapper can look like DeepAgents, queue worker, CLI command,
HTTP handler, benchmark harness, or test fixture.

### Model Selection

DeepAgents accepts model string or LangChain model instance.

Kernel selects model per turn from `onTurnPrepared`.

```ts
import type { ModelMessage } from "ai";

type Context = {
  messages: ModelMessage[];
  tenant: "public" | "enterprise";
};

const hooks: AgentHooks<Context> = {
  onTurnPrepared: ({ context, turn }) => ({
    value: {
      model:
        context.tenant === "enterprise"
          ? "gateway/claude-opus-4-7"
          : turn.turn === 1
            ? "anthropic/claude-sonnet-4-6"
            : "openai/gpt-5-nano",
      messages: context.messages,
    },
  }),
};
```

Kernel variant: provider registry owns gateways, credentials, mTLS fetch, local
models, tenant routes, or test providers.

```ts
import { createOpenAI } from "@ai-sdk/openai";

declare const signedFetch: typeof fetch;

const modelProviders = {
  gateway: createOpenAI({
    baseURL: "https://models.internal/v1",
    apiKey: process.env.MODEL_GATEWAY_TOKEN,
    fetch: signedFetch,
  }),
  local: createOpenAI({
    baseURL: "http://127.0.0.1:11434/v1",
    apiKey: "local",
  }),
};
```

DeepAgents route usually sits in model config or middleware. Kernel route is
durable turn input. Resume from `turn_prepared` or `model_started` reuses
committed model args.

### Prompt Assembly

DeepAgents combines `systemPrompt`, memory files, skills, and harness prompt.

Kernel makes prompt assembly caller-owned.

```ts
import type { ModelMessage } from "ai";
import type { Turn } from "@nanoagent/kernel";

type Context = {
  model: string;
  threadId: string;
  workspaceId: string;
};

declare const prompts: {
  load(workspaceId: string): Promise<string>;
};
declare const messages: {
  load(params: {
    threadId: string;
    turns: readonly Turn[];
  }): Promise<ModelMessage[]>;
};

const hooks: AgentHooks<Context> = {
  onTurnPrepared: async ({ context, state }) => ({
    value: {
      model: context.model,
      messages: [
        { role: "system", content: await prompts.load(context.workspaceId) },
        ...(await messages.load({
          threadId: context.threadId,
          turns: state.turns,
        })),
      ],
    },
  }),
};
```

Kernel variants:

- Load prompt from database, repo file, S3 object, tenant config, or experiment fixture.
- Rebuild messages from external transcript store instead of kernel turns.
- Compact old history before each turn.
- Inject retrieval chunks only when current inbox requires them.
- Persist prompt route in `context` for exact resume.

### Tools

DeepAgents uses LangChain tools and adds built-ins.

Kernel uses Vercel AI SDK `ToolSet`.

```ts
import { jsonSchema, tool, type ToolSet } from "ai";

type Context = {
  root: string;
};

declare function readProjectFile(params: {
  root: string;
  path: string;
}): Promise<string>;

const tools = {
  ReadFile: tool({
    description: "Read UTF-8 file content.",
    inputSchema: jsonSchema<{
      path: string;
    }>({
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    }),
    execute: async ({ path }, options) => {
      const context = options.experimental_context as Context;
      return await readProjectFile({ root: context.root, path });
    },
  }),
} satisfies ToolSet;
```

Kernel variants:

- Expose LangChain-style tools through adapter into `ToolSet`.
- Expose MCP tools through AI SDK-compatible adapter.
- Build product tools directly over service clients.
- Swap tools per process, tenant, test, or benchmark while state remains same.
- Use `context` for tenant, idempotency key, approval state, and storage keys.

### Tool Policy

DeepAgents uses permissions and `interruptOn`.

Kernel separates batch policy, per-call policy, and execution middleware.

Batch policy:

```ts
import type { AgentHooks } from "@nanoagent/kernel";

type Context = Record<string, never>;

const hooks: AgentHooks<Context> = {
  onToolCallsStarted: ({ toolCalls }) => ({
    value: toolCalls.filter((call) => call.toolName !== "DebugOnlyTool"),
  }),
};
```

Per-call policy:

```ts
import type { AgentHooks } from "@nanoagent/kernel";

type Context = {
  approved: string[];
};

declare function isProtectedPath(input: unknown): boolean;

const hooks: AgentHooks<Context> = {
  onToolCallStarted: ({ context, toolCallId, toolName, input }) => {
    if (toolName === "DeleteFile" && isProtectedPath(input)) {
      return {
        value: {
          type: "skip",
          result: {
            toolCallId,
            toolName,
            input,
            output: {
              blocked: true,
              reason: "protected_path",
              retryable: false,
            },
          },
        },
      };
    }

    if (toolName === "ChargeCard" && !context.approved.includes(toolCallId)) {
      return {
        control: {
          type: "pause",
          reason: "approval_required",
          metadata: { toolCallId, toolName },
        },
      };
    }
  },
};
```

Execution wrapper:

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

declare function isTransientNetworkError(error: unknown): boolean;
declare function sleep(ms: number): Promise<void>;

const retryNetworkTools: CallToolMiddleware<Context> = async ({
  input,
  next,
}) => {
  for (let attempt = 0; ; attempt++) {
    const result = await next(input);

    if (!("error" in result)) return result;
    if (!isTransientNetworkError(result.error) || attempt >= 2) return result;

    await sleep(250 * 2 ** attempt);
  }
};
```

Kernel variants:

- Block whole batch before any tool launches.
- Reorder calls before concurrent execution.
- Rewrite arguments for sandboxing.
- Return synthetic denial result instead of hidden exception.
- Pause with exact tool args in committed state.
- Retry only accepted execution.
- Cache, trace, or fixture tools without changing tool code.

### Filesystem

DeepAgents has backend protocol plus built-in filesystem tools.

Kernel treats filesystem as ordinary caller-owned tools.

```ts
import { jsonSchema, tool, type ToolSet } from "ai";

type Context = {
  workspaceId: string;
};

declare const workspaceFs: {
  read(params: { workspaceId: string; path: string }): Promise<string>;
  write(params: {
    workspaceId: string;
    path: string;
    content: string;
  }): Promise<{ path: string; bytes: number }>;
};

const filesystemTools = {
  ReadFile: tool({
    description: "Read file inside workspace.",
    inputSchema: jsonSchema<{ path: string }>({
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    }),
    execute: async ({ path }, options) => {
      const context = options.experimental_context as Context;
      return await workspaceFs.read({
        workspaceId: context.workspaceId,
        path,
      });
    },
  }),
  WriteFile: tool({
    description: "Write file inside workspace.",
    inputSchema: jsonSchema<{ path: string; content: string }>({
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    }),
    execute: async ({ path, content }, options) => {
      const context = options.experimental_context as Context;
      return await workspaceFs.write({
        workspaceId: context.workspaceId,
        path,
        content,
      });
    },
  }),
} satisfies ToolSet;
```

Kernel variants:

- Local filesystem tool for CLI.
- Browser filesystem tool for web IDE.
- Git-backed tool that writes patches only.
- S3/R2 artifact tool.
- Database-backed document tool.
- Sandbox RPC tool.
- Mixed registry where read uses repo snapshot and write creates review patch.

DeepAgents backend normalizes file operation names. Kernel lets product choose
capability shape directly.

### Permissions

DeepAgents `permissions` covers built-in filesystem tools.

Kernel permissions live at hook or tool boundary.

```ts
type Context = {
  tenantId: string;
};

declare const policy: {
  evaluate(params: {
    tenantId: string;
    toolName: string;
    input: unknown;
  }): { allow: true } | { allow: false; policy: string };
};

const hooks: AgentHooks<Context> = {
  onToolCallStarted: ({ context, toolCallId, toolName, input }) => {
    const decision = policy.evaluate({
      tenantId: context.tenantId,
      toolName,
      input,
    });

    if (decision.allow) return;

    return {
      value: {
        type: "skip",
        result: {
          toolCallId,
          toolName,
          input,
          output: {
            blocked: true,
            policy: decision.policy,
            retryable: false,
          },
        },
      },
    };
  },
};
```

Kernel variants:

- Path policy.
- Tool-name policy.
- Tenant budget policy.
- Multi-tool batch policy.
- Approval-based policy.
- Data residency policy.
- Policy that returns user-visible denial as tool output.

Policy applies uniformly to custom tools because caller owns full tool boundary.

### Human Approval

DeepAgents uses `interruptOn` and checkpointer.

Kernel uses `pause` from any hook plus durable `AgentRunState`.

```ts
type Context = {
  approvedToolCallIds: string[];
};

declare function requiresApproval(toolName: string): boolean;

const hooks: AgentHooks<Context> = {
  onToolCallStarted: ({ context, toolCallId, toolName }) => {
    if (!requiresApproval(toolName)) return;
    if (context.approvedToolCallIds.includes(toolCallId)) return;

    return {
      control: {
        type: "pause",
        reason: "approval_required",
        metadata: { toolCallId, toolName },
      },
    };
  },
};
```

Resume:

```ts
import {
  runAgent,
  type AgentHooks,
  type AgentRunState,
  type AgentSaveState,
  type AgentStreamEvent,
} from "@nanoagent/kernel";
import type { ToolSet } from "ai";

declare const emit: (event: AgentStreamEvent) => Promise<void>;
declare const hooks: AgentHooks<Context>;
declare const maxTurns: number;
declare const runId: string;
declare const saveState: AgentSaveState<Context>;
declare const state: AgentRunState<Context>;
declare const toolCallId: string;
declare const tools: ToolSet;
declare const store: {
  load(runId: string): Promise<AgentRunState<Context> | undefined>;
  save(state: AgentRunState<Context>): Promise<void>;
};

await store.save({
  ...state,
  context: {
    ...state.context,
    approvedToolCallIds: [...state.context.approvedToolCallIds, toolCallId],
  },
});

const resumed = await store.load(runId);
if (!resumed) throw new Error(`missing run: ${runId}`);

for await (const event of runAgent({
  state: resumed,
  hooks,
  tools,
  saveState,
  maxTurns,
})) {
  await emit(event);
}
```

Kernel variants:

- Approval before model call.
- Approval before full tool batch.
- Approval for single tool call.
- Approval after tool result before next turn.
- Pause for external webhook, queue delay, budget refill, user message, or file watcher.

Approval is run control.

### Structured Output

DeepAgents exposes LangChain `responseFormat`.

Kernel uses model args, tools, and caller validation. Since `onTurnPrepared`
returns Vercel AI SDK `streamText` options, caller can use provider-supported
response options, output tools, or post-turn validation.

Tool-shaped output:

```ts
import { jsonSchema, tool, type ToolSet } from "ai";

type Review = {
  summary: string;
  risks: string[];
};

const tools = {
  SubmitReview: tool({
    description: "Submit final review.",
    inputSchema: jsonSchema<Review>({
      type: "object",
      properties: {
        summary: { type: "string" },
        risks: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "risks"],
      additionalProperties: false,
    }),
    execute: async (review) => review,
  }),
} satisfies ToolSet;
```

Validation after turn:

```ts
import type {
  AgentHooks,
  AgentToolCallResponse,
} from "@nanoagent/kernel";

type Review = {
  summary: string;
  risks: string[];
};

type Context = {
  review?: Review;
};

declare function extractReview(
  responses: AgentToolCallResponse[],
): Review | undefined;

const hooks: AgentHooks<Context> = {
  onTurnCompleted: ({ context, turn }) => {
    const review = extractReview(turn.toolCalls.completed);
    if (!review) return { control: { type: "continue" } };

    return {
      context: { ...context, review },
      control: { type: "finish", reason: "structured_output_ready" },
    };
  },
};
```

Kernel variants:

- Dedicated submit tool.
- JSON-only provider option.
- Zod validation in hook.
- Product-side parser over final text.
- Multi-turn repair loop when validation fails.
- Store structured output in `context`, database row, or event projection.

### Subagents

DeepAgents has first-class subagent specs and `task` tool.

Kernel expresses subagents as tools that start or run other `runAgent` loops.

Sync delegation:

```ts
import { jsonSchema, tool, type ToolSet } from "ai";
import {
  runAgent,
  type AgentHooks,
  type AgentModelProviders,
  type AgentSaveState,
} from "@nanoagent/kernel";

type Context = {
  threadId: string;
};

type ResearchInput = {
  topic: string;
};

type ResearchContext = {
  parentThreadId: string;
  threadId: string;
  topic: string;
};

declare const researchHooks: AgentHooks<ResearchContext>;
declare const researchTools: ToolSet;
declare const researchStore: {
  save: AgentSaveState<ResearchContext>;
};
declare const modelProviders: AgentModelProviders;

const tools = {
  RunResearchAgent: tool({
    description: "Run focused research worker.",
    inputSchema: jsonSchema<ResearchInput>({
      type: "object",
      properties: {
        topic: { type: "string" },
      },
      required: ["topic"],
      additionalProperties: false,
    }),
    execute: async (input, options) => {
      const parent = options.experimental_context as Context;
      const childRun = runAgent<ResearchContext>({
        state: {
          context: {
            parentThreadId: parent.threadId,
            topic: input.topic,
            threadId: crypto.randomUUID(),
          },
        },
        hooks: researchHooks,
        tools: researchTools,
        modelProviders,
        saveState: researchStore.save,
        maxTurns: 12,
      });

      let answer = "";
      for await (const event of childRun) {
        if (event.type === "model_completed") {
          answer = event.result.text ?? answer;
        }
      }

      return { answer };
    },
  }),
} satisfies ToolSet;
```

Kernel variants:

- In-process child run.
- Queue-backed child run.
- HTTP service child run.
- Worker pool child run.
- Tool that returns child `runId` immediately.
- Parent hook that observes child completion through external event.
- Different state stores for parent and child.
- Different tool registries per child.

DeepAgents subagents are ergonomic. Kernel subagents are just orchestration,
which makes scheduling and storage caller-defined.

### Async Subagents

DeepAgents async subagents target Agent Protocol server.

Kernel expresses async work as tools plus persisted task IDs.

```ts
import { jsonSchema, tool, type ToolSet } from "ai";

type ResearchInput = {
  topic: string;
};

type Context = {
  runId: string;
};

type TaskRecord =
  | { status: "queued" | "running"; taskId: string }
  | { status: "completed"; taskId: string; result: string }
  | { status: "failed"; taskId: string; error: string };

declare const tasks: {
  start(params: {
    parentRunId: string;
    kind: "research";
    input: ResearchInput;
  }): Promise<{ taskId: string }>;
  get(taskId: string): Promise<TaskRecord>;
};

const tools = {
  StartResearchTask: tool({
    description: "Start long research task.",
    inputSchema: jsonSchema<ResearchInput>({
      type: "object",
      properties: {
        topic: { type: "string" },
      },
      required: ["topic"],
      additionalProperties: false,
    }),
    execute: async (input, options) => {
      const context = options.experimental_context as Context;
      return await tasks.start({
        parentRunId: context.runId,
        kind: "research",
        input,
      });
    },
  }),
  CheckResearchTask: tool({
    description: "Check long research task.",
    inputSchema: jsonSchema<{ taskId: string }>({
      type: "object",
      properties: {
        taskId: { type: "string" },
      },
      required: ["taskId"],
      additionalProperties: false,
    }),
    execute: async ({ taskId }) => await tasks.get(taskId),
  }),
} satisfies ToolSet;
```

Kernel variants:

- Agent Protocol task server.
- BullMQ/Temporal queue.
- Durable Execution workflow.
- LangGraph worker.
- Cloud Run job.
- Kubernetes job.
- Human task queue.

Kernel leaves async task protocol to tool schema seen by model.

### Memory

DeepAgents splits memory files, skills, and stores.

Kernel uses caller-owned storage plus `context` keys.

```ts
import type { ModelMessage } from "ai";

type Context = {
  threadId: string;
  userId: string;
  memoryKey: string;
};

declare const memory: {
  load(memoryKey: string): Promise<string>;
  nextKey(memoryKey: string, fact: string): string;
};
declare const messages: {
  load(threadId: string): Promise<ModelMessage[]>;
};
declare function extractFact(output: unknown): string | undefined;

const hooks: AgentHooks<Context> = {
  onTurnPrepared: async ({ context }) => ({
    value: {
      model: "openai/gpt-5.5",
      messages: [
        { role: "system", content: await memory.load(context.memoryKey) },
        ...(await messages.load(context.threadId)),
      ],
    },
  }),
  onToolCallCompleted: ({ context, output }) => {
    const fact = extractFact(output);
    if (!fact) return;
    return {
      context: {
        ...context,
        memoryKey: memory.nextKey(context.memoryKey, fact),
      },
    };
  },
};
```

Kernel variants:

- Prompt memory from Markdown.
- Durable facts in Postgres.
- Vector retrieval from embeddings.
- Artifact memory in S3.
- Session transcript in message store.
- Summaries computed outside loop.
- Memory writes gated by approval hook.

Kernel state records execution. Product memory remains product memory.

### Skills

DeepAgents skills load `SKILL.md` instruction bundles.

Kernel expresses skills as prompt loader, tool bundle, middleware bundle, or all
three.

```ts
import type { ModelMessage } from "ai";

type Context = {
  model: string;
  skillNames: string[];
  threadId: string;
};

declare const skills: {
  render(skillNames: string[]): Promise<string>;
};
declare const messages: {
  load(threadId: string): Promise<ModelMessage[]>;
};

const hooks: AgentHooks<Context> = {
  onTurnPrepared: async ({ context }) => ({
    value: {
      model: context.model,
      messages: [
        { role: "system", content: await skills.render(context.skillNames) },
        ...(await messages.load(context.threadId)),
      ],
    },
  }),
};
```

Kernel variants:

- Skill as Markdown prompt only.
- Skill as tool subset.
- Skill as middleware set.
- Skill as policy profile.
- Skill chosen by tenant, route, subagent, repo path, or user action.
- Skill expansion cached outside kernel.

DeepAgents gives convention. Kernel lets app decide whether skill affects prompt,
tools, policy, or all runtime inputs.

### Streaming

DeepAgents exposes LangChain/LangGraph streaming and DeepAgents event projections.

Kernel returns one async generator with durable phase events plus live model
stream parts.

```ts
import {
  runAgent,
  type AgentHooks,
  type AgentRunState,
  type AgentSaveState,
  type AgentStreamEvent,
  type AgentStreamPartEvent,
} from "@nanoagent/kernel";
import type { ToolSet } from "ai";

type Context = {
  threadId: string;
};

declare const eventLog: {
  append(event: Exclude<AgentStreamEvent, AgentStreamPartEvent>): Promise<void>;
};
declare const hooks: AgentHooks<Context>;
declare const maxTurns: number;
declare const saveState: AgentSaveState<Context>;
declare const sse: {
  write(payload: unknown): Promise<void>;
};
declare const state: AgentRunState<Context> | { context: Context };
declare const tools: ToolSet;
declare function projectModelPart(part: AgentStreamPartEvent["part"]): unknown;
declare function projectPhase(
  event: Exclude<AgentStreamEvent, AgentStreamPartEvent>,
): unknown;

for await (const event of runAgent({ state, hooks, tools, saveState, maxTurns })) {
  if (event.type === "stream_part") {
    await sse.write(projectModelPart(event.part));
    continue;
  }

  await eventLog.append(event);
  await sse.write(projectPhase(event));
}
```

Kernel variants:

- SSE projection.
- WebSocket projection.
- CLI renderer.
- JSONL event log.
- ClickHouse trace projection.
- Test snapshot projection.
- OpenTelemetry spans from hooks/middleware.
- Custom subagent timeline from child run events.

`saveState` receives committed phase events. Live stream parts are caller-routed,
so UI policy stays outside kernel.

### Interpreter

DeepAgents can add QuickJS interpreter middleware.

Kernel expresses interpreter as ordinary tool or `callTool` middleware.

```ts
import { jsonSchema, tool, type ToolSet } from "ai";

type EvalInput = {
  code: string;
};

declare function quickjsEval(params: {
  code: string;
  timeoutMs: number;
}): Promise<unknown>;

const tools = {
  EvalJs: tool({
    description: "Run deterministic JavaScript in isolated interpreter.",
    inputSchema: jsonSchema<EvalInput>({
      type: "object",
      properties: {
        code: { type: "string" },
      },
      required: ["code"],
      additionalProperties: false,
    }),
    execute: async ({ code }) => await quickjsEval({ code, timeoutMs: 250 }),
  }),
} satisfies ToolSet;
```

Kernel variants:

- QuickJS tool.
- Python sandbox tool.
- SQL query tool.
- WASM plugin tool.
- Remote code execution sandbox.
- Policy hook that rewrites or pauses risky code before execution.

Interpreter is capability with schema and policy.

### MCP

DeepAgents consumes MCP through LangChain adapters.

Kernel consumes MCP by adapting server tools into AI SDK `ToolSet`.

```ts
import type { ToolSet } from "ai";

type McpServerConfig = {
  command: string;
  args: string[];
  transport: "stdio";
};

declare const productTools: ToolSet;
declare const contextAwareServerConfig: Record<string, McpServerConfig>;
declare function loadMcpToolSet(params: {
  servers: Record<string, McpServerConfig>;
}): Promise<ToolSet>;

const tools = {
  ...productTools,
  ...(await loadMcpToolSet({
    servers: contextAwareServerConfig,
  })),
} satisfies ToolSet;
```

Kernel variants:

- Load MCP tools per tenant.
- Load MCP tools per run.
- Wrap MCP calls with `callTool` auth, retry, metrics, or approval.
- Hide MCP tools from model by omitting them from `tools`.
- Convert MCP errors into non-retryable tool output.

MCP stays outside kernel. Kernel only needs tool definitions and `execute`.

### ACP And Protocols

DeepAgents has ACP mode through `dcode`.

Kernel leaves protocol shape to adapter. Adapter owns event projection and
resume semantics.

```ts
import {
  runAgent,
  type AgentHooks,
  type AgentRunState,
  type AgentSaveState,
  type AgentStreamEvent,
} from "@nanoagent/kernel";
import type { ToolSet } from "ai";

type ProtocolRunRequest = {
  maxTurns: number;
  runId: string;
};

declare const hooks: AgentHooks<Context>;
declare const protocol: {
  send(payload: unknown): Promise<void>;
};
declare const saveState: AgentSaveState<Context>;
declare const store: {
  load(runId: string): Promise<AgentRunState<Context> | undefined>;
};
declare const tools: ToolSet;
declare function protocolContext(request: ProtocolRunRequest): Context;
declare function projectEvent(event: AgentStreamEvent): unknown;

async function handleProtocolRun(request: ProtocolRunRequest) {
  const state = await store.load(request.runId) ?? {
    runId: request.runId,
    context: protocolContext(request),
  };

  for await (const event of runAgent({
    state,
    hooks,
    tools,
    saveState,
    maxTurns: request.maxTurns,
  })) {
    await protocol.send(projectEvent(event));
  }
}
```

Kernel variants:

- ACP server.
- HTTP/SSE API.
- WebSocket API.
- CLI JSONL.
- GitHub Action.
- Queue worker.
- Browser worker.
- Test runner.

Protocol is adapter-owned runtime boundary.

### CLI

Deep Agents Code is complete CLI product.

Kernel can power CLI, but caller owns command model.

```ts
import {
  runAgent,
  type AgentHooks,
  type AgentSaveState,
  type AgentStreamEvent,
} from "@nanoagent/kernel";
import type { ToolSet } from "ai";

type Context = {
  approvedToolCallIds: string[];
  cwd: string;
  model: string;
  threadId: string;
};

declare const cliHooks: AgentHooks<Context>;
declare const cliStore: { save: AgentSaveState<Context> };
declare const cliTools: ToolSet;
declare const cwd: string;
declare const flags: { maxTurns: number };
declare const model: string;
declare const render: (event: AgentStreamEvent) => Promise<void>;
declare const threadId: string;

for await (const event of runAgent({
  state: {
    context: {
      threadId,
      cwd,
      model,
      approvedToolCallIds: [],
    },
  },
  hooks: cliHooks,
  tools: cliTools,
  saveState: cliStore.save,
  maxTurns: flags.maxTurns,
})) {
  await render(event);
}
```

Kernel variants:

- Interactive TUI.
- Non-interactive CI command.
- JSONL runner.
- Golden-test replay runner.
- Benchmarks over same state machine.
- Product-specific shell policy.

Kernel gives loop; CLI remains product.

### Deployment

DeepAgents points toward LangSmith and LangGraph deployment.

Kernel deploys wherever caller can run TypeScript and persist JSON state.

Kernel variants:

- Express/Hono route.
- Next.js route handler.
- Queue worker.
- Durable Object.
- Lambda with external state store.
- Long-running Node worker.
- Electron process.
- CLI process.
- Benchmark process.

Important deployment invariant: persist `AgentRunState`, recreate process-local
`hooks`, `tools`, `modelProviders`, and `middleware` on resume.

### Observability

DeepAgents inherits LangChain/LangSmith tracing.

Kernel exposes observability at hooks, middleware, events, and `saveState`.

```ts
import type {
  AgentCallModelArgs,
  AgentCallModelResult,
  AgentMiddleware,
  JsonLike,
} from "@nanoagent/kernel";

type CallModelMiddleware<Context extends JsonLike> = AgentMiddleware<
  AgentCallModelArgs<Context>,
  AgentCallModelResult
>;

declare const metrics: {
  histogram(
    name: string,
    value: number,
    attributes: Record<string, string>,
  ): void;
};

const traceModel: CallModelMiddleware<Context> = async ({ input, next }) => {
  const started = performance.now();
  const output = await next(input);

  metrics.histogram("agent.model.duration_ms", performance.now() - started, {
    model: input.args.model,
  });

  return output;
};
```

Kernel variants:

- Trace phase events from `saveState.events`.
- Trace raw stream parts from generator.
- Trace model latency with `callModel`.
- Trace tool latency with `callTool`.
- Store event log independent of state snapshot.
- Project same run into UI, audit log, metrics, and replay tests.

### Error Handling And Resume

DeepAgents offers checkpointer-backed persistence and runtime behavior.

Kernel makes resume point explicit in `AgentRunState.status`.

Rules:

- `paused` resumes from stored phase.
- `failed` resumes from failed phase.
- `model_started` retries model call and emits `model_restarted`.
- `tool_call_completed` resumes only when no tool calls remain `inFlight`.
- In-flight tool replay requires caller reconciliation because external side effects may have started.

Kernel variants:

- Retry model via `callModel` middleware.
- Resume failed provider call from state.
- Reconcile tool side effects before replay.
- Use external idempotency keys from `toolCallId`.
- Mark terminal outcome from `onTurnCompleted`.

### Capability Mapping

DeepAgents feature maps cleanly to kernel extension point.

| DeepAgents functionality | Kernel expression | Flexible variation |
| --- | --- | --- |
| `createDeepAgent` | wrapper around `runAgent` | CLI, worker, HTTP, benchmark, test harness |
| `model` | `onTurnPrepared.value.model` | per-turn route, tenant route, persisted route |
| provider config | `modelProviders` | gateways, local models, test providers, mTLS fetch |
| `tools` | AI SDK `ToolSet` | product tools, MCP adapters, service clients |
| `systemPrompt` | `onTurnPrepared.value.messages` | DB prompt, file prompt, retrieval, compaction |
| `middleware` | `middleware.callModel`, `middleware.callTool` | retry, cache, fallback, trace, fixture, policy |
| `responseFormat` | output tool, provider option, hook validation | repair loop, database write, schema-specific finish |
| `backend` | filesystem tools | local, S3, DB, sandbox, patch-only, composite by registry |
| `permissions` | `onToolCallsStarted`, `onToolCallStarted` | batch policy, path policy, tenant policy, approval |
| `interruptOn` | hook `control: { type: "pause" }` | pause from model, batch, tool, or turn hooks |
| `checkpointer` | `saveState` plus persisted `AgentRunState` | Postgres, Redis, S3, event log, transactional writes |
| `store` | caller storage plus context keys | SQL, vector DB, object store, product memory |
| `memory` | prompt assembly from storage | Markdown, DB facts, retrieval, summaries |
| `skills` | prompt/tool/middleware/profile loader | skills affect prompt, tools, policy, or runtime bundle |
| sync subagents | tool that runs child `runAgent` | in-process, service, queue, worker pool |
| async subagents | start/check/cancel task tools | Agent Protocol, Temporal, BullMQ, LangGraph, jobs |
| streaming | async generator events | SSE, WebSocket, CLI, JSONL, trace projection |
| interpreter | tool or middleware | QuickJS, Python, SQL, WASM, remote sandbox |
| ACP | protocol adapter around `runAgent` | ACP, HTTP, WebSocket, queue, CLI JSONL |
| LangSmith deployment | host runtime plus state store | any Node runtime with durable JSON state |

Shortest comparison: DeepAgents makes common agent product path concise. Kernel
makes each product decision explicit, durable, and replaceable.

## Nanoagent Kernel References

- [Kernel API](docs/kernel/api.md)
- [Kernel hooks](docs/kernel/hooks.md)
- [Kernel middleware](docs/kernel/middleware.md)
- [Kernel tools](docs/kernel/tools.md)
- [Kernel models](docs/kernel/models.md)
- [Kernel state](docs/kernel/state.md)
- [Kernel comparison](docs/kernel/comparison.md)

## Source Links

- [Deep Agents overview](https://docs.langchain.com/oss/javascript/deepagents/overview)
- [Deep Agents quickstart](https://docs.langchain.com/oss/javascript/deepagents/quickstart)
- [Deep Agents models](https://docs.langchain.com/oss/javascript/deepagents/models)
- [Deep Agents customization](https://docs.langchain.com/oss/javascript/deepagents/customization)
- [Deep Agents backends](https://docs.langchain.com/oss/javascript/deepagents/backends)
- [Deep Agents subagents](https://docs.langchain.com/oss/javascript/deepagents/subagents)
- [Deep Agents async subagents](https://docs.langchain.com/oss/javascript/deepagents/async-subagents)
- [Deep Agents permissions](https://docs.langchain.com/oss/javascript/deepagents/permissions)
- [Deep Agents human-in-the-loop](https://docs.langchain.com/oss/javascript/deepagents/human-in-the-loop)
- [Deep Agents memory](https://docs.langchain.com/oss/javascript/deepagents/memory)
- [Deep Agents skills](https://docs.langchain.com/oss/javascript/deepagents/skills)
- [Deep Agents streaming](https://docs.langchain.com/oss/javascript/deepagents/streaming)
- [Deep Agents event streaming](https://docs.langchain.com/oss/javascript/deepagents/event-streaming)
- [Deep Agents interpreters](https://docs.langchain.com/oss/javascript/deepagents/interpreters)
- [LangChain MCP JS](https://docs.langchain.com/oss/javascript/langchain/mcp)
- [Deep Agents ACP](https://docs.langchain.com/oss/javascript/deepagents/acp)
- [Deep Agents Code](https://docs.langchain.com/oss/javascript/deepagents/code/overview)
- [DeepAgents JS reference](https://reference.langchain.com/javascript/deepagents)
- [createDeepAgent reference](https://reference.langchain.com/javascript/deepagents/index/createDeepAgent)
- [Python Deep Agents overview](https://docs.langchain.com/oss/python/deepagents/overview)
