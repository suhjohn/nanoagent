import { runAgent, type AgentStreamEvent } from '@nanoagent/kernel'
import {
  withPlugins,
  sessionPlugin,
  type SessionContext
} from '@nanoagent/plugin'
import { randomUUID } from 'crypto'
import { Effect } from 'effect'

export type RunSessionAgentParams = {
  runId?: string
  prompt: string
  sessionContext?: SessionContext
  onEvent?: (event: AgentStreamEvent) => void
  persister?: (args: { state: any; events: any[] }) => Promise<void>
  modelProvider?: any
}

export async function runSessionAgent ({
  runId = randomUUID(),
  prompt,
  sessionContext,
  onEvent,
  persister,
  modelProvider
}: RunSessionAgentParams) {
  // Use session plugin to manage memory, rate limits, history
  const session = sessionPlugin({ persister })

  // Initialize or use existing context
  const baseContext =
    sessionContext ??
    ({
      history: { items: [], historyVersion: 0 },
      serverReasoningIncluded: false,
      dependencyEnv: {},
      mcpDependencyPrompted: [],
      activeConnectorSelection: [],
      nextTurnIsFirst: true
    } as SessionContext)

  // Add the user prompt directly to the history before the turn starts
  const context: SessionContext = {
    ...baseContext,
    history: {
      ...baseContext.history,
      items: [...baseContext.history.items, { role: 'user', content: prompt }],
      historyVersion: baseContext.history.historyVersion + 1
    }
  }

  const options = withPlugins(
    {
      state: {
        runId,
        revision: 0,
        status: { type: 'running', phase: 'run_started' },
        context,
        turns: [],
        updatedAt: new Date().toISOString()
      },
      maxTurns: 1,
      modelProviders: modelProvider
        ? { openai: () => modelProvider }
        : undefined,
      hooks: {} as any
    },
    [session]
  )

  let finalState: any
  for await (const event of runAgent(options)) {
    onEvent?.(event)
    if (event.type === 'run_completed' || event.type === 'run_failed') {
      // Just catching the state for returning, though in a real app,
      // the persister should be the single source of truth
    }
    // We can infer the final context from the emitted events if needed,
    // or just return the fact that it ran.
  }
}

// CLI Logic
if (import.meta.main) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { dirname, join } = await import("node:path");
  const { runInteractiveCli } = await import("../../common-cli/src");

  const sessionPath = process.env.SESSION_PATH ?? join(tmpdir(), `nano-session-${randomUUID()}.json`);

  async function loadSession(): Promise<SessionContext | undefined> {
    const file = Bun.file(sessionPath);
    if (!(await file.exists())) {
      return undefined;
    }
    return (await file.json()) as SessionContext;
  }

  await runInteractiveCli({
    defaultPrompt: "What is your name? Say it in one sentence.",
    intro: "Session Plugin example.",
    run: async ({ input, cli }) => {
      let sessionContext = await loadSession();

      await runSessionAgent({
        runId: randomUUID(),
        sessionContext,
        prompt: input,
        onEvent: (event) => cli.event(event),
        // Real filesystem persister: writes to disk immediately when kernel saves state
        persister: async ({ state }) => {
          await mkdir(dirname(sessionPath), { recursive: true });
          await writeFile(
            sessionPath,
            JSON.stringify(state.context, null, 2) + "\n"
          );
          // Also update in-memory reference for the current run
          sessionContext = state.context;
        }
      });

      if (sessionContext) {
        cli.json({
          totalHistoryItems: sessionContext.history.items.length,
          sessionPath,
        });
      }
    },
  });
}
