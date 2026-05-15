import { type JsonLike, runAgent, type AgentStreamEvent, type AgentPhaseEvent, type AgentRunState, type AgentSaveState } from "@nanoagent/kernel";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ModelMessage } from "ai";

export type ChatMessage = {
  [key: string]: JsonLike;
  role: "system" | "user" | "assistant" | "tool";
  content: string | any;
};

export type SparseContext = {
  [key: string]: JsonLike;
  messages: ChatMessage[];
};

export type SparseDeps = {
  checkpointPath: string;
  eventsPath: string;
  streamToClient?: (event: AgentStreamEvent) => void;
};

// Checkpoint only at major boundaries, not intermediate phases
function shouldCheckpoint({ state, events }: { state: AgentRunState<SparseContext>; events: AgentPhaseEvent[] }) {
  if (events.length === 0) return true;

  return events.some((event) => {
    switch (event.type) {
      case "turn_prepared":
      case "model_completed":
      case "tool_call_completed":
      case "turn_completed":
      case "run_completed":
      case "pause":
      case "run_failed":
        return true;
      default:
        return state.status.type !== "running";
    }
  });
}

async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, path);
}

async function appendJsonl(path: string, events: AgentStreamEvent[]) {
  if (events.length === 0) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    { flag: "a" },
  );
}

export async function runSparse(params: {
  deps: SparseDeps;
  runId: string;
  context: SparseContext;
  state?: AgentRunState<SparseContext>;
}) {
  let finalState: AgentRunState<SparseContext> | undefined;

  const saveState: AgentSaveState<SparseContext> = async ({ state, events }) => {
    finalState = state;
    // 1. Append every event to the fast log
    await appendJsonl(params.deps.eventsPath, events);

    // 2. Only write the full heavy state object if it's an important boundary
    if (shouldCheckpoint({ state, events })) {
      await writeJsonAtomic(params.deps.checkpointPath, { state });
    }
  };

  for await (const event of runAgent<SparseContext>({
    state: params.state ?? { runId: params.runId, context: params.context },
    maxTurns: 1,
    saveState,
    hooks: {
      onTurnPrepared: ({ context }) => ({
        value: {
          model: "openai/gpt-5.4-mini",
          messages: [
            {
              role: "system",
              content: "You are testing sparse checkpoints. Answer in one short sentence.",
            },
            ...context.messages,
          ] as unknown as ModelMessage[],
        },
      }),
      onTurnCompleted: ({ context, turn }) => ({
        context: {
          messages: [
            ...context.messages,
            {
              role: "assistant",
              content: turn.modelResult?.text ?? "",
            },
          ],
        },
      }),
    },
  })) {
    params.deps.streamToClient?.(event);
  }

  return finalState;
}
