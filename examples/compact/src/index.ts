import type { ModelMessage } from "ai";
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
  model: string;
  sessionId: string;
  userId: string;
};

type SessionMemory = {
  messages: ModelMessage[];
  summary?: string;
};

type MemoryStore = {
  append(sessionId: string, messages: ModelMessage[]): Promise<void>;
  load(sessionId: string): Promise<SessionMemory>;
  replace(sessionId: string, memory: SessionMemory): Promise<void>;
};

type CompactDeps = {
  compact(input: {
    messages: ModelMessage[];
    previousSummary?: string;
  }): Promise<string>;
  loadState(runId: string): Promise<AgentRunState<Context> | undefined>;
  memory: MemoryStore;
  modelProviders?: AgentModelProviders;
  saveState(runId: string, state: AgentRunState<Context>): Promise<void>;
  streamToClient(event: AgentStreamEvent): Promise<void> | void;
};

type CompactPolicy = {
  compactAfterMessages: number;
  keepRecentMessages: number;
};

const defaultPolicy = {
  compactAfterMessages: 16,
  keepRecentMessages: 6,
} satisfies CompactPolicy;

function withSummary(memory: SessionMemory) {
  if (!memory.summary) return memory.messages;

  return [
    {
      role: "system",
      content: `Conversation summary:\n${memory.summary}`,
    } satisfies ModelMessage,
    ...memory.messages,
  ];
}

async function loadCompactedMemory(params: {
  compact: CompactDeps["compact"];
  memory: MemoryStore;
  policy: CompactPolicy;
  sessionId: string;
}) {
  const memory = await params.memory.load(params.sessionId);
  if (memory.messages.length <= params.policy.compactAfterMessages) {
    return memory;
  }

  const compactAt = Math.max(
    0,
    memory.messages.length - params.policy.keepRecentMessages,
  );
  const previous = memory.messages.slice(0, compactAt);
  const recent = memory.messages.slice(compactAt);
  const summary = await params.compact({
    previousSummary: memory.summary,
    messages: previous,
  });
  const compacted = { summary, messages: recent } satisfies SessionMemory;
  await params.memory.replace(params.sessionId, compacted);
  return compacted;
}

function makeHooks(params: {
  compact: CompactDeps["compact"];
  memory: MemoryStore;
  policy: CompactPolicy;
}): AgentHooks<Context> {
  return {
    onTurnPrepared: async ({ context }) => {
      const memory = await loadCompactedMemory({
        compact: params.compact,
        memory: params.memory,
        policy: params.policy,
        sessionId: context.sessionId,
      });

      return {
        value: {
          model: context.model,
          messages: withSummary(memory),
        },
      };
    },

    onTurnCompleted: async ({ context, turn }) => {
      const modelResult = turn.modelResult;
      if (!modelResult) return;

      await params.memory.append(
        context.sessionId,
        modelResult.response.messages,
      );
    },
  };
}

export async function appendUserMessage(params: {
  content: string;
  memory: MemoryStore;
  sessionId: string;
}) {
  await params.memory.append(params.sessionId, [
    { role: "user", content: params.content },
  ]);
}

export async function runCompactAgent(params: {
  deps: CompactDeps;
  model?: string;
  policy?: Partial<CompactPolicy>;
  runId: string;
  sessionId: string;
  userId: string;
}) {
  const saved = await params.deps.loadState(params.runId);
  const state = saved ?? {
    runId: params.runId,
    context: {
      model: params.model ?? "openai/gpt-5-nano",
      sessionId: params.sessionId,
      userId: params.userId,
    },
  };
  const policy = { ...defaultPolicy, ...params.policy };

  for await (const event of runAgent<Context>({
    state,
    modelProviders: params.deps.modelProviders,
    hooks: makeHooks({
      compact: params.deps.compact,
      memory: params.deps.memory,
      policy,
    }),
    maxTurns: 1,
    saveState: async ({ state }) => {
      await params.deps.saveState(state.runId, state);
    },
  })) {
    await params.deps.streamToClient(event);
  }
}
