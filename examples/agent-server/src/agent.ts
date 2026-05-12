import type { ModelMessage } from "ai";
import {
  type AgentHooks,
  type AgentModelProviders,
  type AgentStreamEvent,
  runAgent,
} from "@nanoagent/kernel";
import {
  appendMessages,
  type Context,
  type Db,
  flushInbox,
  hasInbox,
  loadState,
  makeSaveState,
} from "./db";

function makeHooks(params: {
  db: Db;
  model: string;
  sessionId: string;
}): AgentHooks<Context> {
  return {
    onTurnPrepared: async () => {
      const inbox = await flushInbox(params.db, params.sessionId);
      if (!inbox.flushed) {
        return {
          control: {
            type: "finish",
            reason: "inbox_empty",
          },
        };
      }

      return {
        value: {
          model: params.model,
          messages: inbox.messages,
        },
      };
    },
    onTurnCompleted: async ({ turn }) => {
      const modelResult = turn.modelResult;
      if (!modelResult) return;

      await appendMessages(
        params.db,
        params.sessionId,
        modelResult.response.messages,
      );

      if (await hasInbox(params.db, params.sessionId)) {
        return {
          control: {
            type: "continue",
          },
        };
      }
    },
  };
}

export async function runSessionAgent(params: {
  db: Db;
  model: string;
  modelProviders?: AgentModelProviders;
  runId: string;
  sessionId: string;
  streamToClient?: (event: AgentStreamEvent) => Promise<void> | void;
  userId: string;
}) {
  const saved = await loadState(params.db, params.runId);
  const state = saved ?? {
    runId: params.runId,
    context: {
      sessionId: params.sessionId,
      userId: params.userId,
    },
  };

  for await (const event of runAgent<Context>({
    state,
    modelProviders: params.modelProviders,
    hooks: makeHooks({
      db: params.db,
      model: params.model,
      sessionId: params.sessionId,
    }),
    maxTurns: Number.MAX_SAFE_INTEGER,
    saveState: makeSaveState(params.db),
  })) {
    await params.streamToClient?.(event);
  }
}
