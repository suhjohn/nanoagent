import type { ModelMessage, ToolSet } from "ai";
import {
  type AgentHooks,
  type AgentModelProviders,
  type AgentRunState,
  type AgentSaveState,
  type JsonLike,
  runAgent,
} from "@nanoagent/kernel";

type Context = {
  [key: string]: JsonLike;
  approved: string[];
  sessionId: string;
  slackChannelId: string;
  userId: string;
};

type StoredEvent = Parameters<AgentSaveState<Context>>[0]["events"][number];
type PauseEvent = Extract<StoredEvent, { type: "pause" }>;

type RunStore = {
  load(runId: string): Promise<AgentRunState<Context> | undefined>;
  save(params: {
    state: AgentRunState<Context>;
    events: readonly StoredEvent[];
  }): Promise<void>;
};

type SlackApproval = {
  channelId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
};

type Slack = {
  postApproval(params: SlackApproval): Promise<void>;
};

type MessageStore = {
  append(runId: string, messages: ModelMessage[]): Promise<void>;
  load(runId: string): Promise<ModelMessage[]>;
};

type HumanApprovalDeps = {
  messages: MessageStore;
  modelProviders: AgentModelProviders;
  slack: Slack;
  store: RunStore;
  tools: ToolSet;
};

function isApprovalPauseEvent(event: StoredEvent): event is PauseEvent {
  return event.type === "pause" && event.reason === "approval_required";
}

function readApproval(event: PauseEvent) {
  const metadata = event.metadata;

  if (
    typeof metadata === "object" &&
    metadata !== null &&
    !Array.isArray(metadata)
  ) {
    const approval = metadata as { readonly [key: string]: JsonLike };

    if (
      typeof approval.toolCallId === "string" &&
      typeof approval.toolName === "string"
    ) {
      return {
        toolCallId: approval.toolCallId,
        toolName: approval.toolName,
      };
    }
  }

  throw new Error("approval pause missing tool metadata");
}

function makeHooks(params: {
  messages: MessageStore;
  runId: string;
}): AgentHooks<Context> {
  return {
    onTurnPrepared: async () => ({
      value: {
        model: "openai/gpt-5.4-mini",
        messages: await params.messages.load(params.runId),
      },
    }),

    onToolCallStarted: ({ context, toolCallId, toolName }) => {
      if (toolName !== "ChargeCard") return;
      if (context.approved.includes(toolCallId)) return;

      return {
        control: {
          type: "pause",
          reason: "approval_required",
          metadata: { toolCallId, toolName },
        },
      };
    },

    onTurnCompleted: async ({ turn }) => {
      const modelResult = turn.modelResult;
      if (!modelResult) return;

      await params.messages.append(params.runId, modelResult.response.messages);
    },
  };
}

function makeSaveState(params: {
  slack: Slack;
  store: RunStore;
}): AgentSaveState<Context> {
  return async ({ state, events }) => {
    await params.store.save({ state, events });

    const approvalEvent = events.find(isApprovalPauseEvent);
    if (!approvalEvent) return;

    const approval = readApproval(approvalEvent);
    await params.slack.postApproval({
      runId: state.runId,
      channelId: state.context.slackChannelId,
      toolCallId: approval.toolCallId,
      toolName: approval.toolName,
    });
  };
}

function createInitialState(params: {
  runId: string;
  slackChannelId: string;
  userId: string;
}) {
  return {
    runId: params.runId,
    context: {
      approved: [],
      sessionId: params.runId,
      slackChannelId: params.slackChannelId,
      userId: params.userId,
    },
  };
}

export async function startOrResume(params: {
  deps: HumanApprovalDeps;
  runId: string;
  slackChannelId: string;
  userId: string;
}) {
  const saved = await params.deps.store.load(params.runId);

  for await (const event of runAgent<Context>({
    state: saved ?? createInitialState(params),
    tools: params.deps.tools,
    modelProviders: params.deps.modelProviders,
    hooks: makeHooks({
      messages: params.deps.messages,
      runId: params.runId,
    }),
    maxTurns: 20,
    saveState: makeSaveState({
      slack: params.deps.slack,
      store: params.deps.store,
    }),
  })) {
    console.log(event.type);
  }
}

export async function approveFromSlack(params: {
  deps: HumanApprovalDeps;
  runId: string;
  toolCallId: string;
}) {
  const saved = await params.deps.store.load(params.runId);
  if (!saved) throw new Error(`missing run: ${params.runId}`);

  await params.deps.store.save({
    state: {
      ...saved,
      revision: saved.revision + 1,
      updatedAt: new Date().toISOString(),
      context: {
        ...saved.context,
        approved: [...new Set([...saved.context.approved, params.toolCallId])],
      },
    },
    events: [],
  });

  const approved = await params.deps.store.load(params.runId);
  if (!approved) throw new Error(`missing run: ${params.runId}`);

  await startOrResume({
    deps: params.deps,
    runId: approved.runId,
    userId: approved.context.userId,
    slackChannelId: approved.context.slackChannelId,
  });
}
