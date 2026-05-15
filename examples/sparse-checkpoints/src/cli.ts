import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { runInteractiveCli } from "../../common-cli/src";
import { runSparse, type SparseContext } from "./index";
import type { AgentRunState } from "@nanoagent/kernel";

const sessionDir = process.env.SESSION_DIR ?? join(tmpdir(), "nano-sparse-checkpoints");
const sessionId = process.env.SESSION_ID ?? randomUUID();
const checkpointPath = join(sessionDir, `${sessionId}.checkpoint.json`);
const eventsPath = join(sessionDir, `${sessionId}.events.jsonl`);

async function loadSessionState(): Promise<AgentRunState<SparseContext> | undefined> {
  try {
    const data = await readFile(checkpointPath, "utf8");
    return JSON.parse(data).state;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as any).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

await runInteractiveCli({
  defaultPrompt: "Explain sparse checkpoints in one sentence.",
  intro: `Sparse checkpoints example.\ncheckpoint: ${checkpointPath}\nevents: ${eventsPath}`,
  run: async ({ input, cli }) => {
    let state = await loadSessionState();
    const runId = state?.runId ?? sessionId;

    let context: SparseContext;
    if (state && state.status.type !== "completed") {
      context = { ...state.context, messages: [...state.context.messages, { role: "user", content: input }] };
      state = { ...state, context };
    } else {
      context = {
        messages: state 
          ? [...state.context.messages, { role: "user", content: input }]
          : [{ role: "user", content: input }]
      };
      state = undefined;
    }

    const finalState = await runSparse({
      deps: {
        checkpointPath,
        eventsPath,
        streamToClient: (event) => cli.event(event),
      },
      runId,
      context,
      state,
    });

    cli.json({
      checkpointPath,
      eventsPath,
      revision: finalState?.revision,
      status: finalState?.status,
      turns: finalState?.turns.length,
    });
  },
});
