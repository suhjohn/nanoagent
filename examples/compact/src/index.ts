import type { ModelMessage } from "ai";
import {
  type AgentHooks,
  type AgentModelProviders,
  type AgentStreamEvent,
  runAgent,
} from "@nanoagent/kernel";
import {
  appendContextMessages,
  appendMessages,
  createSession,
  type Db,
  getSession,
  loadSessionContext,
  loadState,
  makeSaveState,
  saveSessionContext,
  type RunContext,
} from "./db";

export * from "./db";

type CompactDeps = {
  compact(input: {
    messages: ModelMessage[];
    turnTotalTokens: number;
  }): Promise<string>;
  db: Db;
  modelProviders?: AgentModelProviders;
  streamToClient(event: AgentStreamEvent): Promise<void> | void;
};

type CompactPolicy = {
  compactAfterTurnTokens: number;
  keepRecentMessages: number;
};

const defaultPolicy = {
  compactAfterTurnTokens: 8_000,
  keepRecentMessages: 6,
} satisfies CompactPolicy;

async function compactContextAfterTurn(params: {
  compact: CompactDeps["compact"];
  db: Db;
  policy: CompactPolicy;
  sessionId: string;
  turnTotalTokens: number;
}) {
  const context = loadSessionContext(params.db, params.sessionId);
  if (params.turnTotalTokens < params.policy.compactAfterTurnTokens) return;

  const compactAt = Math.max(
    0,
    context.length - params.policy.keepRecentMessages,
  );
  if (compactAt === 0) return;

  const previous = context.slice(0, compactAt);
  const recent = context.slice(compactAt);
  const summary = await params.compact({
    messages: previous,
    turnTotalTokens: params.turnTotalTokens,
  });

  saveSessionContext(params.db, {
    sessionId: params.sessionId,
    context: [
      {
        role: "system",
        content: `Conversation summary:\n${summary}`,
      },
      ...recent,
    ],
  });
}

export function appendUserMessage(params: {
  content: string;
  db: Db;
  runId?: string;
  sessionId: string;
}) {
  const message = {
    role: "user",
    content: params.content,
  } satisfies ModelMessage;
  appendMessages(params.db, {
    sessionId: params.sessionId,
    runId: params.runId,
    messages: [message],
  });
  appendContextMessages(params.db, {
    sessionId: params.sessionId,
    messages: [message],
  });
  return message;
}

export async function runCompactAgent(params: {
  deps: CompactDeps;
  model?: string;
  policy?: Partial<CompactPolicy>;
  runId: string;
  sessionId: string;
  userId: string;
}) {
  const existing = getSession(params.deps.db, params.sessionId);
  const session =
    existing ??
    createSession(params.deps.db, {
      id: params.sessionId,
      model: params.model ?? "openai/gpt-5.4-mini",
      userId: params.userId,
    });
  const saved = loadState(params.deps.db, params.runId);
  const state = saved ?? {
    runId: params.runId,
    context: {
      model: params.model ?? session.model,
      sessionId: params.sessionId,
      userId: params.userId,
    },
  };
  const policy = { ...defaultPolicy, ...params.policy };
  const hooks = {
    onTurnPrepared: ({ context }) => ({
      value: {
        model: context.model,
        messages: loadSessionContext(params.deps.db, context.sessionId),
      },
    }),

    onTurnCompleted: async ({ context, turn }) => {
      const modelResult = turn.modelResult;
      if (!modelResult) return;
      const messages = modelResult.response.messages;
      const turnTotalTokens =
        modelResult.totalUsage.totalTokens ??
        (modelResult.totalUsage.inputTokens ?? 0) +
          (modelResult.totalUsage.outputTokens ?? 0);

      appendMessages(params.deps.db, {
        sessionId: context.sessionId,
        runId: params.runId,
        messages,
      });
      appendContextMessages(params.deps.db, {
        sessionId: context.sessionId,
        messages,
      });

      await compactContextAfterTurn({
        compact: params.deps.compact,
        db: params.deps.db,
        policy,
        sessionId: context.sessionId,
        turnTotalTokens,
      });
    },
  } satisfies AgentHooks<RunContext>;

  for await (const event of runAgent<RunContext>({
    state,
    modelProviders: params.deps.modelProviders,
    hooks,
    maxTurns: 1,
    saveState: makeSaveState(params.deps.db),
  })) {
    await params.deps.streamToClient(event);
  }
}
