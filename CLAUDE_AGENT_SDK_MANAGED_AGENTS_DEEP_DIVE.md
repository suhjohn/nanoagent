# Claude Agent SDK And Managed Agents Deep Dive

Claude Agent SDK and Claude Managed Agents expose same agent harness at different ownership boundaries.

Agent SDK runs Claude Code harness as process you host. Managed Agents runs hosted agent harness as Anthropic-managed session service. Nanoagent kernel expresses same capability set as caller-owned durable loop primitives.

Checked May 20, 2026:

- npm `@anthropic-ai/claude-agent-sdk@0.3.145`
- PyPI `claude-agent-sdk@0.2.82`
- npm `@anthropic-ai/sdk@0.97.1`
- Managed Agents beta header: `managed-agents-2026-04-01`
- Current public docs under `code.claude.com/docs/en/agent-sdk` and `platform.claude.com/docs/en/managed-agents`

Examples use `declare const` for caller-owned services, stores, emitters, policies, and tool implementations.

## Surfaces

Claude exposes three practical agent surfaces.

- Claude Agent SDK: TypeScript and Python SDKs that spawn bundled Claude Code binary.
- Claude Code CLI: interactive and headless terminal product.
- Claude Managed Agents: hosted API resources for agents, environments, sessions, events, memory, files, and self-hosted sandbox workers.

The old public naming was `Claude Code SDK`. Current npm package is `@anthropic-ai/claude-agent-sdk`. Docs and search results still use both names.

## Agent SDK Shape

Primary TypeScript entrypoint is `query`.

```ts
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const messages: SDKMessage[] = [];

for await (const message of query({
  prompt: "Review current authentication changes.",
  options: {
    cwd: "/workspace/app",
    model: "claude-opus-4-7",
    maxTurns: 8,
    tools: { type: "preset", preset: "claude_code" },
    allowedTools: ["Read", "Grep", "Glob"],
    permissionMode: "dontAsk",
  },
})) {
  messages.push(message);
}
```

Caller ergonomics are process-oriented. `query()` returns `Query`, an async generator with control methods. SDK owns agent loop, transcript format, tool semantics, subprocess lifecycle, and Claude Code behavior. Caller configures process, listens to messages, and handles permissions.

## Agent SDK Options

Current TypeScript declaration exposes broad `Options` surface.

```ts
query({
  prompt,
  options: {
    abortController,
    additionalDirectories,
    agent,
    agents,
    allowedTools,
    canUseTool,
    continue,
    cwd,
    disallowedTools,
    toolAliases,
    tools,
    env,
    executable,
    executableArgs,
    extraArgs,
    fallbackModel,
    enableFileCheckpointing,
    toolConfig,
    forkSession,
    betas,
    hooks,
    onElicitation,
    persistSession,
    sessionStore,
    sessionStoreFlush,
    loadTimeoutMs,
    includeHookEvents,
    includePartialMessages,
    forwardSubagentText,
    thinking,
    effort,
    maxThinkingTokens,
    maxTurns,
    maxBudgetUsd,
    taskBudget,
    mcpServers,
    model,
    outputFormat,
    pathToClaudeCodeExecutable,
    permissionMode,
    planModeInstructions,
    allowDangerouslySkipPermissions,
    permissionPromptToolName,
    plugins,
    promptSuggestions,
    agentProgressSummaries,
    resume,
    sessionId,
    resumeSessionAt,
    sandbox,
    settings,
    managedSettings,
    settingSources,
    skills,
    debug,
    debugFile,
    stderr,
    strictMcpConfig,
    systemPrompt,
    title,
    spawnClaudeCodeProcess,
  },
});
```

Important caller boundary: `Options` includes non-serializable process values. Store session IDs and app state. Recreate SDK options per process.

## Query Control

`Query` extends async generator and adds control methods.

```ts
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

declare const cwd: string;
declare const inputStream: AsyncIterable<SDKUserMessage>;

const run = query({
  prompt: inputStream,
  options: {
    cwd,
    model: "claude-opus-4-7",
    includePartialMessages: true,
  },
});

await run.setPermissionMode("plan");
await run.setModel("claude-sonnet-4-6");
await run.interrupt();
await run.close();
```

Supported controls include:

- `interrupt()`
- `setPermissionMode(mode)`
- `setModel(model?)`
- `applyFlagSettings(settings)`
- `initializationResult()`
- `supportedCommands()`
- `supportedModels()`
- `supportedAgents()`
- `mcpServerStatus()`
- `getContextUsage()`
- `readFile(path, options?)`
- `reloadPlugins()`
- `accountInfo()`
- `rewindFiles(userMessageId, options?)`
- `reconnectMcpServer(serverName)`
- `toggleMcpServer(serverName, enabled)`
- `setMcpServers(servers)`
- `streamInput(stream)`
- `stopTask(taskId)`
- `backgroundTasks(toolUseId?)`
- `close()`

Caller ergonomics: long-running UI can steer session while it runs. Stateless job runner mostly consumes stream and stores result.

## Agent SDK Tools

Agent SDK exposes Claude Code tool surface.

Built-in tool input union includes:

- `Agent`
- `AskUserQuestion`
- `Bash`
- `TaskOutput`
- `EnterWorktree`
- `ExitPlanMode`
- `FileEdit`
- `FileRead`
- `FileWrite`
- `Glob`
- `Grep`
- `ListMcpResources`
- `Mcp`
- `Monitor`
- `NotebookEdit`
- `ReadMcpResource`
- `SubscribeMcpResource`
- `SubscribePolling`
- `TaskCreate`
- `TaskGet`
- `TaskList`
- `TaskStop`
- `TaskUpdate`
- `TodoWrite`
- `WebFetch`
- `WebSearch`

Tool availability is configured through `tools`, `allowedTools`, `disallowedTools`, `toolAliases`, MCP servers, plugins, and subagents.

```ts
const run = query({
  prompt: "Find failing test and patch it.",
  options: {
    cwd,
    tools: ["Read", "Grep", "Glob", "Bash", "Edit"],
    allowedTools: ["Read", "Grep", "Glob"],
    disallowedTools: ["WebSearch"],
    toolAliases: {
      Bash: "mcp__workspace__bash",
    },
  },
});
```

`toolAliases` is notable: caller can redirect built-in tool names to MCP tools. This lets product preserve Claude Code skill instructions while changing execution substrate.

## Agent SDK Permissions

Permission surface has three layers.

- `permissionMode`: coarse session behavior.
- `allowedTools` / `disallowedTools`: declarative tool policy.
- `canUseTool`: runtime callback before each tool call.

```ts
import type {
  CanUseTool,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";

declare const approvals: {
  request(params: {
    title: string;
    toolName: string;
    input: Record<string, unknown>;
    toolUseID: string;
  }): Promise<"allow" | "deny">;
};

const canUseTool: CanUseTool = async (toolName, input, context) => {
  if (toolName === "Read") return { behavior: "allow" } satisfies PermissionResult;

  const result = await approvals.request({
    title: context.title ?? `Claude wants to use ${toolName}`,
    toolName,
    input,
    toolUseID: context.toolUseID,
  });

  return result === "allow"
    ? { behavior: "allow" }
    : { behavior: "deny", message: "Denied by user." };
};

const run = query({
  prompt: "Update billing workflow.",
  options: {
    permissionMode: "dontAsk",
    canUseTool,
  },
});
```

Permission modes:

- `default`
- `acceptEdits`
- `bypassPermissions`
- `plan`
- `dontAsk`
- `auto`

`bypassPermissions` requires `allowDangerouslySkipPermissions: true`.

## Agent SDK Hooks

Hooks observe and affect Claude Code phases.

Hook events include:

- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `PostToolBatch`
- `Notification`
- `UserPromptSubmit`
- `UserPromptExpansion`
- `SessionStart`
- `SessionEnd`
- `Stop`
- `StopFailure`
- `SubagentStart`
- `SubagentStop`
- `PreCompact`
- `PostCompact`
- `PermissionRequest`
- `PermissionDenied`
- `Setup`
- `TeammateIdle`
- `TaskCreated`
- `TaskCompleted`
- `Elicitation`
- `ElicitationResult`
- `ConfigChange`
- `WorktreeCreate`
- `WorktreeRemove`
- `InstructionsLoaded`
- `CwdChanged`
- `FileChanged`

```ts
const run = query({
  prompt: "Audit this repository.",
  options: {
    includeHookEvents: true,
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            async (input) => {
              if (input.tool_input.command.includes("rm -rf")) {
                return {
                  decision: "block",
                  reason: "Destructive command blocked.",
                };
              }
              return { continue: true };
            },
          ],
        },
      ],
    },
  },
});
```

Hooks are Claude Code lifecycle hooks, not general durable phase contracts. They are strong for policy, logging, and prompt/tool interventions inside Claude Code harness.

## Agent SDK Sessions

SDK persists session transcripts under Claude config by default. Caller can use `resume`, `continue`, `sessionId`, `resumeSessionAt`, `forkSession`, `persistSession`, and `sessionStore`.

```ts
declare const cwd: string;
declare const sessionId: string;

const first = query({
  prompt: "Start refactor. Stop after plan.",
  options: {
    sessionId,
    cwd,
    permissionMode: "plan",
  },
});

const resumed = query({
  prompt: "Implement approved plan.",
  options: {
    resume: sessionId,
    permissionMode: "acceptEdits",
  },
});
```

`sessionStore` mirrors transcripts to external storage while local transcript writes still occur. This is useful when product needs searchable conversation archive or cloud worker resume.

## Agent SDK Subagents

`agents` defines custom subagents invoked through `Agent` tool. `agent` can run main thread as named agent.

```ts
declare const cwd: string;

const run = query({
  prompt: "Review diff and run targeted tests.",
  options: {
    agent: "code-reviewer",
    agents: {
      "code-reviewer": {
        description: "Reviews TypeScript changes for correctness.",
        prompt: "Return concrete findings with file paths and evidence.",
        tools: ["Read", "Grep", "Glob", "Bash"],
        model: "claude-opus-4-7",
        effort: "xhigh",
        permissionMode: "dontAsk",
        maxTurns: 8,
      },
      researcher: {
        description: "Finds related prior art and docs.",
        prompt: "Research context and return concise citations.",
        tools: ["WebSearch", "WebFetch"],
        background: true,
      },
    },
    agentProgressSummaries: true,
    forwardSubagentText: true,
  },
});
```

Subagent definition supports:

- `description`
- `tools`
- `disallowedTools`
- `prompt`
- `model`
- `mcpServers`
- `criticalSystemReminder_EXPERIMENTAL`
- `skills`
- `initialPrompt`
- `maxTurns`
- `background`
- `memory`
- `effort`
- `permissionMode`

Ergonomic read: subagents are native Claude Code concepts. Caller chooses names and permissions, but scheduling and conversation shape live in harness.

## Agent SDK MCP

SDK supports process, SSE, HTTP, and in-process SDK MCP servers.

```ts
import {
  createSdkMcpServer,
  query,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";

declare const billing: {
  lookup(invoiceId: string): Promise<{ status: string; total: number }>;
};

const billingServer = createSdkMcpServer({
  name: "billing",
  tools: [
    tool(
      "lookup_invoice",
      "Look up invoice status by invoice ID.",
      { invoiceId: z.string() },
      async ({ invoiceId }) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(await billing.lookup(invoiceId)),
          },
        ],
      }),
    ),
  ],
});

const run = query({
  prompt: "Check invoice inv_123.",
  options: {
    mcpServers: {
      billing: billingServer,
    },
    allowedTools: ["mcp__billing__lookup_invoice"],
  },
});
```

MCP ergonomics are strong when product accepts MCP naming and permission model. For local service code, in-process SDK MCP avoids separate process management.

## Agent SDK Skills And Plugins

Skills load through setting sources and `skills` option.

```ts
const run = query({
  prompt: "Extract invoice data from PDF.",
  options: {
    cwd: "/workspace/project",
    settingSources: ["user", "project"],
    skills: ["pdf", "docx"],
    allowedTools: ["Read", "Grep", "Glob", "Bash"],
  },
});
```

SDK skill caveat: `allowed-tools` frontmatter in `SKILL.md` applies to Claude Code CLI directly. In SDK apps, caller controls access through main `allowedTools` option.

Plugins can package commands, agents, skills, and hooks.

```ts
const run = query({
  prompt: "Use repository plugin workflow.",
  options: {
    plugins: [{ type: "local", path: "/workspace/plugins/reviewer" }],
  },
});
```

## Agent SDK Structured Output

`outputFormat` supports JSON schema output.

```ts
const run = query({
  prompt: "Summarize release risk.",
  options: {
    outputFormat: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          risks: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["summary", "risks"],
        additionalProperties: false,
      },
    },
  },
});
```

This is response boundary, not tool boundary. For workflows needing side effects plus typed result, combine tool policy with final output schema.

## Agent SDK Sandbox And Hosting

SDK bundles native Claude Code binary through optional platform packages. Host requirements from docs: Python 3.10+ for Python SDK, Node.js 18+ for TypeScript SDK, recommended 1GiB RAM, 5GiB disk, 1 CPU, outbound HTTPS to `api.anthropic.com`, and optional MCP/external tool access.

Sandbox option controls command isolation.

```ts
const run = query({
  prompt: "Run tests safely.",
  options: {
    cwd,
    tools: ["Read", "Grep", "Glob", "Bash"],
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      network: {
        allowLocalBinding: false,
      },
    },
  },
});
```

Docs clarify filesystem and network restrictions come from permission configuration. Sandbox controls sandbox behavior and dependency behavior.

## Agent SDK File Checkpointing

`enableFileCheckpointing` tracks file changes. `Query.rewindFiles()` can restore files to state at user message.

```ts
declare const userMessageId: string;

const run = query({
  prompt: "Apply refactor.",
  options: {
    cwd,
    enableFileCheckpointing: true,
  },
});

const rewind = await run.rewindFiles(userMessageId, { dryRun: true });
```

Ergonomic read: checkpointing is file-focused. It helps code editing workflows. It is separate from durable agent state.

## Managed Agents Shape

Managed Agents moves harness into Anthropic API resources.

Core concepts:

- Agent: versioned model, system prompt, tools, MCP servers, skills, multiagent config.
- Environment: cloud container or self-hosted sandbox execution location.
- Session: running agent instance inside environment.
- Events: user inputs, agent outputs, tool requests, tool results, status, spans.

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
declare const environmentId: string;

const agent = await client.beta.agents.create({
  name: "Coding Assistant",
  model: "claude-opus-4-7",
  system: "You are a precise coding agent.",
  tools: [{ type: "agent_toolset_20260401" }],
  betas: ["managed-agents-2026-04-01"],
});

const session = await client.beta.sessions.create({
  agent: agent.id,
  environment_id: environmentId,
  title: "Fix auth tests",
  betas: ["managed-agents-2026-04-01"],
});

await client.beta.sessions.events.send(session.id, {
  events: [
    {
      type: "user.message",
      content: [{ type: "text", text: "Run tests and fix auth failures." }],
    },
  ],
  betas: ["managed-agents-2026-04-01"],
});
```

Caller ergonomics are resource-oriented. You manage API resources and event streams, not subprocesses.

## Managed Agents Agent Resource

Agent create/update fields:

- `name`
- `model`
- `system`
- `tools`
- `mcp_servers`
- `skills`
- `multiagent`
- `description`
- `metadata`

Agents are versioned. Updates require current `version` and increment stored version when configuration changes. Session can use latest agent ID or pinned `{ id, version }`.

```ts
const agent = await client.beta.agents.create({
  name: "Support Engineer",
  model: {
    id: "claude-opus-4-7",
    speed: "fast",
  },
  system: "Diagnose production incidents and propose minimal fixes.",
  tools: [
    {
      type: "agent_toolset_20260401",
      default_config: {
        enabled: false,
      },
      configs: [
        { name: "read", enabled: true },
        { name: "grep", enabled: true },
        { name: "bash", enabled: true },
      ],
    },
  ],
  metadata: {
    owner: "platform",
  },
  betas: ["managed-agents-2026-04-01"],
});
```

## Managed Agents Environments

Environment controls where session container runs.

Cloud environment:

```ts
declare const allowedHosts: string[];

const environment = await client.beta.environments.create({
  name: "support-prod",
  config: {
    type: "cloud",
    networking: {
      type: "limited",
      allowed_hosts: allowedHosts,
      allow_mcp_servers: true,
      allow_package_managers: false,
    },
  },
  betas: ["managed-agents-2026-04-01"],
});
```

Environment facts:

- Multiple sessions can share environment.
- Each session gets isolated container.
- Sessions do not share filesystem state.
- Environments persist until archived or deleted.
- Environments are not versioned.

Self-hosted sandbox keeps orchestration in Anthropic and moves tool execution into caller infrastructure. Worker claims work items, creates execution context, runs tool calls locally, and posts results back.

## Managed Agents Sessions

Session references agent and environment. Create session first, then send event to start work.

```ts
import type { BetaManagedAgentsAgent } from "@anthropic-ai/sdk/resources/beta";

declare const agent: BetaManagedAgentsAgent;
declare const environment: { id: string };
declare const render: (event: unknown) => Promise<void>;

const session = await client.beta.sessions.create({
  agent: { id: agent.id, version: agent.version },
  environment_id: environment.id,
  title: "Investigate checkout failures",
  betas: ["managed-agents-2026-04-01"],
});

const stream = await client.beta.sessions.events.stream(session.id, {
  betas: ["managed-agents-2026-04-01"],
});

for await (const event of stream) {
  await render(event);
}
```

Session statuses:

- `idle`
- `running`
- `rescheduling`
- `terminated`

Idle sessions preserve conversation history. When session goes idle, container checkpoint preserves filesystem, installed packages, and files. Docs state checkpoints are preserved for 30 days after last activity.

## Managed Agents Events

Managed Agents is event-based.

User event examples:

- `user.message`
- `user.tool_confirmation`
- `user.custom_tool_result`
- `user.interrupt`
- `user.define_outcome`

Session and agent event examples:

- `session.status_idle`
- `session.status_running`
- `session.status_rescheduled`
- `session.status_terminated`
- `agent.message`
- `agent.thinking`
- `agent.tool_use`
- `agent.tool_result`
- `agent.mcp_tool_use`
- `agent.custom_tool_use`
- span events for model and outcome evaluation

Tool confirmation flow:

1. Session emits `agent.tool_use` or `agent.mcp_tool_use`.
2. Session emits `session.status_idle` with `stop_reason: requires_action`.
3. Caller sends `user.tool_confirmation` with `allow` or `deny`.
4. Session returns to `running`.

Custom tool flow:

1. Session emits `agent.custom_tool_use`.
2. Session idles with `requires_action`.
3. Caller executes app tool.
4. Caller sends `user.custom_tool_result`.

## Managed Agents Tools

Built-in toolset `agent_toolset_20260401` includes:

- `bash`
- `read`
- `write`
- `edit`
- `glob`
- `grep`
- `web_fetch`
- `web_search`

Tools can be disabled or enabled individually.

```ts
const tools = [
  {
    type: "agent_toolset_20260401",
    default_config: { enabled: false },
    configs: [
      { name: "read", enabled: true },
      { name: "grep", enabled: true },
      { name: "glob", enabled: true },
    ],
  },
  {
    type: "custom",
    name: "lookup_ticket",
    description: "Look up ticket status by ticket ID.",
    input_schema: {
      type: "object",
      properties: {
        ticket_id: { type: "string" },
      },
      required: ["ticket_id"],
      additionalProperties: false,
    },
  },
];
```

Docs state tool output over 100K tokens is written to file in sandbox and model receives truncated preview plus path.

## Managed Agents Permissions

Permission policies apply to server-executed tools: pre-built agent toolset and MCP toolset. Custom tools are app-executed and controlled by caller.

Policies:

- `always_allow`
- `always_ask`

```ts
const tools = [
  {
    type: "agent_toolset_20260401",
    default_config: {
      permission_policy: { type: "always_allow" },
    },
    configs: [
      {
        name: "bash",
        permission_policy: { type: "always_ask" },
      },
    ],
  },
];
```

MCP toolsets default to `always_ask` so newly added MCP tools do not execute without approval.

## Managed Agents Custom Tools

Custom tool is schema in agent definition and callback in app event loop.

```ts
declare const tickets: {
  lookup(ticketId: string): Promise<{ status: string; owner: string }>;
};

for await (const event of await client.beta.sessions.events.stream(session.id, {
  betas: ["managed-agents-2026-04-01"],
})) {
  if (event.type !== "agent.custom_tool_use") continue;
  if (event.name !== "lookup_ticket") continue;

  const input = event.input as { ticket_id: string };
  const result = await tickets.lookup(input.ticket_id);

  await client.beta.sessions.events.send(session.id, {
    events: [
      {
        type: "user.custom_tool_result",
        custom_tool_use_id: event.id,
        content: [{ type: "text", text: JSON.stringify(result) }],
      },
    ],
    betas: ["managed-agents-2026-04-01"],
  });
}
```

`client.beta.sessions.events.toolRunner()` can dispatch incoming `agent.tool_use` and `agent.custom_tool_use` events to local tool registry and send matching result back.

## Managed Agents Memory

Agent Memory is research preview. Memory store is workspace-scoped text document collection optimized for Claude. Sessions are ephemeral by default; attached memory stores carry learnings across sessions.

Memory store behavior:

- Create store with `name` and `description`.
- Seed store with path/content documents.
- Attach up to 8 stores at session creation through `resources`.
- Store access can be `read_write` or `read_only`.
- Store prompt can provide session-specific memory instructions.
- Individual memory limit is 100KB.
- Every memory mutation creates immutable version for audit and rollback.
- Attached stores mount in session container under `/mnt/memory/`.

```ts
declare const agent: { id: string };
declare const environment: { id: string };

const memoryStore = await client.beta.memoryStores.create({
  name: "Team Conventions",
  description: "Project conventions and preferences.",
  betas: ["managed-agents-2026-04-01"],
});

await client.beta.memoryStores.memories.create(memoryStore.id, {
  path: "/formatting.md",
  content: "All dates use ISO-8601.",
  betas: ["managed-agents-2026-04-01"],
});

const session = await client.beta.sessions.create({
  agent: agent.id,
  environment_id: environment.id,
  resources: [
    {
      type: "memory_store",
      memory_store_id: memoryStore.id,
      access: "read_write",
      prompt: "Check this store before starting work.",
    },
  ],
  betas: ["managed-agents-2026-04-01"],
});
```

Agent receives memory tools like `memory_list`, `memory_search`, `memory_read`, `memory_write`, `memory_edit`, and `memory_delete`.

## Managed Agents Files And Resources

Sessions can attach resources including memory stores, files, and GitHub repositories. Session resource lifecycle is independent from agent and environment lifecycle.

Important semantics from docs:

- Deleting session removes session record, events, and associated container.
- Files, memory stores, vaults, skills, environments, and agents are independent resources.
- Session-local agent tools and MCP server config can be updated while idle.

This makes Managed Agents useful for long-running hosted workflows, but caller must track resource ownership and cleanup.

## Managed Agents Multiagent

Agent config supports `multiagent`: primary thread orchestrates work by spawning session threads that run agents from roster.

Managed multiagent differs from Agent SDK subagents:

- Agent SDK subagents run inside caller-hosted Claude Code subprocess harness.
- Managed Agents multiagent runs inside hosted session service with session threads.
- Session thread events and status are part of API event model.

## Managed Agents Self-Hosted Sandbox

Self-hosted sandbox keeps control plane hosted and moves tool execution to caller infrastructure.

Worker responsibilities:

- Poll environment work queue or wake from webhook.
- Spawn execution context per session.
- Download skills.
- Run tool calls locally.
- Submit results back.
- Retain/redact logs according to caller policy.
- Secure container image, network egress, service key, mounted volumes, and process user.

Docs state Anthropic secures control plane. Caller owns container hardening, network controls, service key storage, trust boundary isolation, tool-execution blast radius, and log retention for self-hosted workers.

## Caller Ergonomics

Agent SDK fits apps that want Claude Code behavior in own process boundary.

Strong parts:

- Same harness as Claude Code.
- Mature coding tool surface.
- Process-level controls.
- Rich hooks and permissions.
- Local/MCP extensibility.
- Subagents, background tasks, plan mode, prompt suggestions.
- Session persistence and file checkpointing.
- Works well for CLI, IDE, worker, and local automation.

Sharp parts:

- Hosted app must run long-lived subprocess.
- Transcript/session semantics come from Claude Code.
- Tool surface is Claude-specific.
- Durable state is session transcript, not caller-shaped phase state.
- Self-hosting requires sandbox and permission discipline.
- Some APIs are alpha or marked experimental in type declarations.

Managed Agents fits apps that want Anthropic to host orchestration and session runtime.

Strong parts:

- Versioned agent resources.
- Hosted container sessions.
- Event-driven API.
- Built-in toolset and permissions.
- Hosted/session event observability.
- Cloud or self-hosted execution environment.
- Memory stores, files, resources, session checkpointing.
- Custom tools by event callback.
- Multiagent sessions.

Sharp parts:

- Beta API header and evolving surface.
- Hosted resource lifecycle and cleanup required.
- Custom tools are asynchronous event work.
- Permission policies cover server/MCP tools, while custom tools remain caller-owned.
- Environment lacks built-in versioning.
- Cloud sessions do not share filesystem state.
- Container checkpoints expire after inactivity window.
- Self-hosted sandbox shifts major security responsibilities to caller.

## Nanoagent Kernel Comparison

Kernel expresses same capabilities as smaller durable loop.

Agent SDK and Managed Agents answer product questions for caller: tool names, session store, transcript shape, permissions, compaction, subprocess/runtime, hosted container, event protocol. Kernel keeps those outside loop.

### Construction

Agent SDK:

```ts
const run = query({
  prompt,
  options: {
    cwd,
    model,
    tools: { type: "preset", preset: "claude_code" },
  },
});
```

Managed Agents:

```ts
const session = await client.beta.sessions.create({
  agent: agent.id,
  environment_id: environment.id,
  betas: ["managed-agents-2026-04-01"],
});
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

Kernel variant: caller can wrap `runAgent` into CLI, worker, HTTP endpoint, ACP server, eval runner, or hosted agent service.

### Model Routing

Agent SDK model is `options.model`, `fallbackModel`, `thinking`, `effort`, and mid-session `setModel`.

Managed Agents model is agent resource field and optionally versioned config.

Kernel model is turn-preparation value.

```ts
import type { ModelMessage } from "ai";
import type { AgentHooks } from "@nanoagent/kernel";

type Context = {
  followupModel: string;
  initialModel: string;
  messages: ModelMessage[];
};

const hooks: AgentHooks<Context> = {
  onTurnPrepared: ({ context, turn }) => ({
    value: {
      model:
        turn.turn === 1
          ? context.initialModel
          : context.followupModel,
      messages: context.messages,
    },
  }),
};
```

Kernel variation: route by tenant, turn number, cost budget, evaluation arm, data boundary, prior tool errors, or queue priority. Route is persisted in `AgentRunState.currentTurn.modelArgs` after `turn_prepared`.

### Prompt And Session Memory

Agent SDK reads Claude Code settings, `CLAUDE.md`, skills, plugins, and session transcript.

Managed Agents reads agent `system`, attached resources, memory stores, files, GitHub resources, and session history.

Kernel prompt assembly is caller hook.

```ts
import type { ModelMessage } from "ai";
import type { AgentHooks, Turn } from "@nanoagent/kernel";

type Context = {
  memoryKeys: string[];
  model: string;
  threadId: string;
};

declare const promptBuilder: {
  messages(params: {
    threadId: string;
    runTurns: readonly Turn[];
    memoryKeys: string[];
  }): Promise<ModelMessage[]>;
};

const hooks: AgentHooks<Context> = {
  onTurnPrepared: async ({ context, state }) => ({
    value: {
      model: context.model,
      messages: await promptBuilder.messages({
        threadId: context.threadId,
        runTurns: state.turns,
        memoryKeys: context.memoryKeys,
      }),
    },
  }),
};
```

Kernel variation:

- Store transcript in Postgres.
- Store artifacts in S3.
- Load `CLAUDE.md`, `AGENTS.md`, or product prompt.
- Attach retrieval chunks.
- Compact by token budget.
- Pin prompt version in context.

### Tools

Agent SDK tools are Claude Code tools plus MCP/plugin tools.

Managed Agents tools are hosted agent toolset, MCP toolsets, and custom tools.

Kernel tools are caller `ToolSet`.

```ts
import { jsonSchema, tool, type ToolSet } from "ai";

type Context = {
  workspaceId: string;
};

declare const workspace: {
  read(params: { workspaceId: string; path: string }): Promise<string>;
};

const tools = {
  ReadFile: tool({
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

Kernel variation: use Claude-like names, product-domain names, MCP adapters, sandbox RPC tools, browser tools, queue-backed tools, or no filesystem tools at all.

### Permission And Approval

Agent SDK uses `permissionMode`, allow/deny rules, hooks, and `canUseTool`.

Managed Agents uses `always_allow` / `always_ask` permission policies for server/MCP tools, and custom-tool event handling for app tools.

Kernel uses hooks before launch.

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

Kernel variation:

- Pause before model call.
- Pause before full tool batch.
- Pause for one tool call.
- Skip with synthetic denial result.
- Rewrite tool input.
- Finish run from policy.
- Count approvals in durable context.

### Hooks

Agent SDK hooks are Claude Code hook events.

Managed Agents events are API event stream.

Kernel hooks are phase contracts on durable run loop.

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

Kernel variation: every phase can update `context`, return value, or return control depending on hook. State commits before phase event reaches caller.

### Sessions And Resume

Agent SDK resume is Claude Code session ID and transcript store.

Managed Agents resume is session ID and hosted session state.

Kernel resume is caller-loaded `AgentRunState`.

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
declare const runId: string;
declare const runStore: {
  load(runId: string): Promise<AgentRunState<Context>>;
};
declare const saveState: AgentSaveState<Context>;
declare const tools: ToolSet;

const saved = await runStore.load(runId);

for await (const event of runAgent({
  state: saved,
  hooks,
  tools,
  saveState,
  maxTurns: 20,
})) {
  await emit(event);
}
```

Kernel variation: save latest state in Postgres, append phase events to ClickHouse, store artifacts in S3, and replay UI from event log.

### Streaming

Agent SDK streams `SDKMessage`.

Managed Agents streams session events and spans.

Kernel streams phase events plus live `stream_part` model parts.

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
declare const state: AgentRunState<Context>;
declare const tools: ToolSet;
declare const ui: {
  write(payload: unknown): Promise<void>;
};
declare function projectModelPart(part: AgentStreamPartEvent["part"]): unknown;
declare function projectPhase(
  event: Exclude<AgentStreamEvent, AgentStreamPartEvent>,
): unknown;

for await (const event of runAgent({ state, hooks, tools, saveState, maxTurns })) {
  if (event.type === "stream_part") {
    await ui.write(projectModelPart(event.part));
    continue;
  }

  await eventLog.append(event);
  await ui.write(projectPhase(event));
}
```

Kernel variation: render SSE, WebSocket, CLI, JSONL, trace events, deterministic test snapshots, or hosted protocol events.

### Subagents And Multiagent

Agent SDK has `agents` and Agent tool.

Managed Agents has `multiagent` and session threads.

Kernel uses tools or orchestration service.

```ts
import { jsonSchema, tool, type ToolSet } from "ai";

type Context = {
  runId: string;
};

type WorkerInput = {
  task: string;
};

declare const workers: {
  start(params: {
    parentRunId: string;
    input: WorkerInput;
  }): Promise<{ runId: string }>;
};

const tools = {
  StartWorker: tool({
    description: "Start research worker and return run ID.",
    inputSchema: jsonSchema<WorkerInput>({
      type: "object",
      properties: {
        task: { type: "string" },
      },
      required: ["task"],
      additionalProperties: false,
    }),
    execute: async (input, options) => {
      const parent = options.experimental_context as Context;
      return await workers.start({
        parentRunId: parent.runId,
        input,
      });
    },
  }),
} satisfies ToolSet;
```

Kernel variation: child run in same process, queue worker, service call, process pool, managed agent session, or external Agent SDK subprocess.

### MCP

Agent SDK has process/SSE/HTTP/SDK MCP configs and query controls.

Managed Agents has MCP servers, MCP toolsets, vaults, and event/permission flow.

Kernel consumes MCP by adapting MCP tools to `ToolSet`.

```ts
import type { ToolSet } from "ai";

declare const productTools: ToolSet;
declare function loadMcpTools(): Promise<ToolSet>;

const tools = {
  ...productTools,
  ...(await loadMcpTools()),
} satisfies ToolSet;
```

Kernel variation: load MCP tools per tenant, per run, per route, or per approval state. Wrap calls with `callTool` middleware.

### Sandbox And Environment

Agent SDK caller hosts process and optionally configures sandbox.

Managed Agents cloud environment hosts container. Self-hosted environment hosts tool execution on caller infrastructure.

Kernel environment is whatever executes tools.

```ts
import type { ToolSet } from "ai";

declare const containerRunner: unknown;
declare const mountPolicy: unknown;
declare const networkPolicy: unknown;
declare const patchStore: unknown;
declare const workspaceFs: unknown;
declare function patchOnlyWriteTool(patchStore: unknown): ToolSet[string];
declare function sandboxedBashTool(params: {
  runner: unknown;
  networkPolicy: unknown;
  mountPolicy: unknown;
}): ToolSet[string];
declare function workspaceReadTool(workspaceFs: unknown): ToolSet[string];

const tools = {
  Bash: sandboxedBashTool({
    runner: containerRunner,
    networkPolicy,
    mountPolicy,
  }),
  ReadFile: workspaceReadTool(workspaceFs),
  WriteFile: patchOnlyWriteTool(patchStore),
};
```

Kernel variation: local process, Docker, Firecracker, Kubernetes job, Browser VM, Managed Agents custom tool bridge, or Claude Agent SDK subprocess tool.

### Structured Output

Agent SDK uses `outputFormat`.

Managed Agents can use custom tool results, outcome definitions, and event parsing.

Kernel uses output tool, provider options, or hook validation.

```ts
import type { AgentHooks, Turn } from "@nanoagent/kernel";

type Report = {
  summary: string;
};

type Context = {
  report?: Report;
};

declare function parseReport(turn: Turn): Report | undefined;

const hooks: AgentHooks<Context> = {
  onTurnCompleted: ({ context, turn }) => {
    const report = parseReport(turn);
    if (!report) return { control: { type: "continue" } };

    return {
      context: { ...context, report },
      control: { type: "finish", reason: "report_ready" },
    };
  },
};
```

Kernel variation: repair loop, JSON schema tool, product parser, persisted report row, event projection.

### Memory

Agent SDK memory comes from Claude Code settings, files, skills, plugins, and session store.

Managed Agents memory stores are first-class API resources.

Kernel memory is caller storage plus prompt assembly.

```ts
import type { ModelMessage } from "ai";
import type { AgentHooks, Turn } from "@nanoagent/kernel";

type Context = {
  memoryStoreIds: string[];
  model: string;
  threadId: string;
};

declare const memoryWriter: {
  capture(params: { context: Context; turn: Turn }): Promise<void>;
};
declare const promptBuilder: {
  messages(params: {
    threadId: string;
    memoryStoreIds: string[];
  }): Promise<ModelMessage[]>;
};

const hooks: AgentHooks<Context> = {
  onTurnPrepared: async ({ context }) => ({
    value: {
      model: context.model,
      messages: await promptBuilder.messages({
        threadId: context.threadId,
        memoryStoreIds: context.memoryStoreIds,
      }),
    },
  }),
  onTurnCompleted: async ({ context, turn }) => {
    await memoryWriter.capture({ context, turn });
  },
};
```

Kernel variation: attach OpenAI/Anthropic memory store, app database, vector DB, markdown files, or project-specific convention docs.

### Observability

Agent SDK emits SDK messages and optional hook lifecycle events.

Managed Agents emits session, agent, and span events with console trace view.

Kernel exposes observability through `saveState`, events, hooks, and middleware.

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
  record(
    name: string,
    value: number,
    attributes: Record<string, string>,
  ): Promise<void>;
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

Kernel variation: preserve raw events, project to tracing, replay in tests, or map onto Managed Agents event shape.

## Capability Mapping

| Capability | Agent SDK | Managed Agents | Nanoagent kernel |
| --- | --- | --- | --- |
| agent creation | `query({ prompt, options })` | `client.beta.agents.create` plus sessions | caller wrapper around `runAgent` |
| execution owner | caller process | Anthropic-hosted session service | caller process |
| model | `options.model`, `setModel`, `fallbackModel` | versioned agent model | `onTurnPrepared.value.model` |
| prompt | Claude Code settings, prompt, skills | agent `system`, resources, memory | caller-built messages |
| tools | Claude Code tools, MCP, plugins | agent toolset, MCP, custom tools | AI SDK `ToolSet` |
| permissions | `permissionMode`, rules, `canUseTool`, hooks | `always_allow`, `always_ask`, custom event handling | hook pause/skip/rewrite |
| sessions | Claude session ID and transcript | hosted session ID and container checkpoint | persisted `AgentRunState` |
| streaming | `SDKMessage` generator | session event stream | phase events plus stream parts |
| subagents | `agents`, `Agent` tool | `multiagent`, session threads | child `runAgent`, queue, or service tool |
| MCP | local/process/SSE/HTTP/SDK servers | MCP servers, toolsets, vaults | MCP-to-ToolSet adapter |
| memory | files/settings/session store | memory stores, session resources | caller storage plus prompt hook |
| sandbox | local sandbox option, caller host | cloud environment or self-hosted worker | caller tool runtime |
| structured output | `outputFormat` | event/tool/outcome layer | output tool or hook validation |
| file rollback | `enableFileCheckpointing`, `rewindFiles` | container checkpoint, resources | caller artifact/state strategy |
| observability | SDK messages, hooks | events, spans, console trace | event log, hooks, middleware |

## Decision Frame

Use Agent SDK when:

- You want Claude Code harness behavior.
- You can host long-running subprocesses.
- Product is CLI, IDE, local worker, or controlled backend job.
- Claude-specific tool surface is acceptable.
- You need rich local permissions, hooks, skills, MCP, and file edits.

Use Managed Agents when:

- You want Anthropic-hosted orchestration.
- You need versioned agent resources and hosted sessions.
- You prefer event API over subprocess management.
- You want cloud containers or self-hosted sandbox worker pattern.
- You want managed memory stores, files, GitHub resources, and session traces.

Use nanoagent kernel when:

- You want provider-agnostic agent loop.
- Product owns transcript, memory, tools, permissions, and runtime.
- Durable phase state matters more than harness convenience.
- You need to experiment with storage, policy, scheduling, tool registries, or protocol shape.
- You want same loop behind CLI, service, queue, browser, or hosted system.

## Source Links

- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Agent SDK loop](https://code.claude.com/docs/en/agent-sdk/agent-loop)
- [Hosting Agent SDK](https://code.claude.com/docs/en/agent-sdk/hosting)
- [Agent SDK skills](https://code.claude.com/docs/en/agent-sdk/skills)
- [Agent SDK permissions](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [Managed Agents quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart)
- [Managed Agents agent setup](https://platform.claude.com/docs/en/managed-agents/agent-setup)
- [Managed Agents sessions](https://platform.claude.com/docs/en/managed-agents/sessions)
- [Managed Agents event stream](https://platform.claude.com/docs/en/managed-agents/events-and-streaming)
- [Managed Agents tools](https://platform.claude.com/docs/en/managed-agents/tools)
- [Managed Agents permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies)
- [Managed Agents environments](https://platform.claude.com/docs/en/managed-agents/environments)
- [Managed Agents self-hosted sandboxes](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes)
- [Managed Agents self-hosted security model](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes-security)
- [Managed Agents memory](https://platform.claude.com/docs/en/managed-agents/memory)
- [Kernel API](docs/kernel/api.md)
- [Kernel hooks](docs/kernel/hooks.md)
- [Kernel middleware](docs/kernel/middleware.md)
- [Kernel tools](docs/kernel/tools.md)
- [Kernel state](docs/kernel/state.md)
