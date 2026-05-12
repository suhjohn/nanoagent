import type { ModelMessage, ToolSet } from "ai";
import {
  type AgentHooks,
  type AgentModelProviders,
  type AgentRunState,
  type AgentStreamEvent,
  type JsonLike,
  runAgent,
} from "@nanoagent/kernel";

type Context = {
  [key: string]: JsonLike;
  complexity: "simple" | "hard";
  sessionId: string;
};

type Session = {
  messages: ModelMessage[];
};

type TenantTier = "free" | "pro" | "enterprise";

type TenantContext = Context & {
  tenantId: string;
  tenantTier: TenantTier;
};

type Tenant = {
  id: string;
  tier: TenantTier;
};

type ModelRoutingDeps = {
  classifyPrompt(prompt: string): Context["complexity"];
  loadState<C extends JsonLike>(
    runId: string,
  ): Promise<AgentRunState<C> | undefined>;
  loadTenant(tenantId: string): Promise<Tenant>;
  saveState<C extends JsonLike>(
    runId: string,
    state: AgentRunState<C>,
  ): Promise<void>;
  modelProviders?: AgentModelProviders;
  streamToClient(event: AgentStreamEvent): void;
  tools: ToolSet;
};

const states = new Map<string, AgentRunState<Context>>();
const sessions = new Map<string, Session>();

function session(sessionId: string, initialPrompt: string): Session {
  const existing = sessions.get(sessionId);
  if (existing) return existing;

  const created = {
    messages: [{ role: "user", content: initialPrompt }],
  } satisfies Session;
  sessions.set(sessionId, created);
  return created;
}

const perTurnHooks: AgentHooks<Context> = {
  onTurnPrepared: ({ context, turn }) => {
    const model =
      turn.turn === 1
        ? "openai/gpt-5.4-mini"
        : context.complexity === "hard"
          ? "openai/gpt-5.4-mini"
          : "openai/gpt-5.4-mini";

    return {
      value: {
        model,
        messages: session(context.sessionId, "").messages,
      },
    };
  },
  onTurnCompleted: ({ context, turn }) => {
    const modelResult = turn.modelResult;
    if (!modelResult) return;

    session(context.sessionId, "").messages.push(
      ...modelResult.response.messages,
    );
  },
};

export async function runSupportAgent(params: {
  classifyPrompt: ModelRoutingDeps["classifyPrompt"];
  modelProviders?: AgentModelProviders;
  runId: string;
  prompt: string;
  streamToClient: ModelRoutingDeps["streamToClient"];
}) {
  const state = states.get(params.runId) ?? {
    runId: params.runId,
    context: {
      complexity: params.classifyPrompt(params.prompt),
      sessionId: params.runId,
    },
  };
  session(params.runId, params.prompt);

  for await (const event of runAgent<Context>({
    state,
    modelProviders: params.modelProviders,
    hooks: perTurnHooks,
    maxTurns: 5,
    saveState: async ({ state }) => {
      states.set(state.runId, state);
    },
  })) {
    params.streamToClient(event);
  }
}

const tenantHooks: AgentHooks<TenantContext> = {
  onTurnPrepared: ({ context }) => {
    const model =
      context.tenantTier === "enterprise"
        ? "openai/gpt-5.4-mini"
        : context.tenantTier === "pro" && context.complexity === "hard"
          ? "openai/gpt-5.4-mini"
          : "openai/gpt-5.4-mini";

    return {
      value: {
        model,
        messages: session(context.sessionId, "").messages,
      },
    };
  },
  onTurnCompleted: ({ context, turn }) => {
    const modelResult = turn.modelResult;
    if (!modelResult) return;

    session(context.sessionId, "").messages.push(
      ...modelResult.response.messages,
    );
  },
};

export async function startOrResumeTenantRun(params: {
  deps: ModelRoutingDeps;
  runId: string;
  tenantId: string;
  prompt: string;
}) {
  const saved = await params.deps.loadState<TenantContext>(params.runId);
  const tenant = await params.deps.loadTenant(params.tenantId);
  const state:
    | AgentRunState<TenantContext>
    | {
        runId: string;
        context: TenantContext;
      } =
    saved ??
    ({
      runId: params.runId,
      context: {
        complexity: params.deps.classifyPrompt(params.prompt),
        sessionId: params.runId,
        tenantId: tenant.id,
        tenantTier: tenant.tier,
      },
    } satisfies { runId: string; context: TenantContext });
  session(params.runId, params.prompt);

  for await (const event of runAgent<TenantContext>({
    state,
    modelProviders: params.deps.modelProviders,
    tools: params.deps.tools,
    hooks: tenantHooks,
    maxTurns: 20,
    saveState: async ({ state }) => {
      await params.deps.saveState(state.runId, state);
    },
  })) {
    params.deps.streamToClient(event);
  }
}
