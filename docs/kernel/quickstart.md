# Quickstart

Build local SQLite-backed agent.

```sh
npm init -y
npm pkg set type=module
npm install @nanoagent/kernel ai better-sqlite3
npm install --save-dev @types/better-sqlite3 tsx typescript
```

```ts
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { ModelMessage } from "ai";
import { runAgent, type AgentHooks, type AgentRunState } from "@nanoagent/kernel";

type Context = {
  sessionId: string;
  userId: string;
};

type RunRow = {
  state_json: string;
};

type MessageRow = {
  message_json: string;
};

const db = new Database("agent.sqlite");
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_runs (
    run_id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    message_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function loadState(params: {
  runId: string;
}): AgentRunState<Context> | undefined {
  const row = db
    .prepare("SELECT state_json FROM agent_runs WHERE run_id = ?")
    .get(params.runId) as RunRow | undefined;

  return row
    ? (JSON.parse(row.state_json) as AgentRunState<Context>)
    : undefined;
}

function saveState(params: { state: AgentRunState<Context> }) {
  db.prepare(
    `
      INSERT INTO agent_runs (run_id, state_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `,
  ).run(
    params.state.runId,
    JSON.stringify(params.state),
    params.state.updatedAt,
  );
}

function loadMessages(params: { sessionId: string }) {
  const rows = db
    .prepare(
      `
        SELECT message_json
        FROM agent_messages
        WHERE session_id = ?
        ORDER BY id ASC
      `,
    )
    .all(params.sessionId) as MessageRow[];

  return rows.map((row) => JSON.parse(row.message_json) as ModelMessage);
}

function appendMessages(params: {
  messages: readonly ModelMessage[];
  sessionId: string;
}) {
  const insert = db.prepare(
    "INSERT INTO agent_messages (session_id, message_json) VALUES (?, ?)",
  );

  const write = db.transaction((messages: readonly ModelMessage[]) => {
    for (const message of messages) {
      insert.run(params.sessionId, JSON.stringify(message));
    }
  });

  write(params.messages);
}

async function main() {
  const runId = process.env.RUN_ID ?? randomUUID();
  const sessionId = process.env.SESSION_ID ?? "local";
  const prompt =
    process.argv.slice(2).join(" ") || "Write a one sentence project brief.";

  const saved = loadState({ runId });
  if (!saved) {
    appendMessages({
      sessionId,
      messages: [{ role: "user", content: prompt }],
    });
  }

  const hooks: AgentHooks<Context> = {
    onTurnPrepared: ({ context }) => ({
      value: {
        model: "openai/gpt-5-nano",
        messages: loadMessages({ sessionId: context.sessionId }),
      },
    }),
    onTurnCompleted: ({ context, turn }) => {
      const result = turn.modelResult;
      if (!result) return;

      appendMessages({
        sessionId: context.sessionId,
        messages: result.response.messages,
      });
    },
  };

  for await (const event of runAgent<Context>({
    state:
      saved ??
      ({
        runId,
        context: {
          sessionId,
          userId: "local-user",
        },
      } satisfies { runId: string; context: Context }),
    hooks,
    maxTurns: 3,
    saveState: ({ state }) => saveState({ state }),
  })) {
    if (event.type === "stream_part" && event.part.type === "text-delta") {
      process.stdout.write(event.part.text);
    }
  }

  process.stdout.write(`\n\nrunId=${runId}\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

Run it:

```sh
OPENAI_API_KEY=... npx tsx local-agent.ts "Write a one sentence project brief."
```

Resume same run after restart:

```sh
RUN_ID=<printed-run-id> OPENAI_API_KEY=... npx tsx local-agent.ts
```

## Focus

Read three parts first:

- `agent_runs`: stores resumable kernel state.
- `agent_messages`: stores caller-owned conversation memory.
- `hooks`: turns SQLite state into model input, then writes model output back.

Everything else is wiring: `runAgent` receives saved state, runs until completion or turn cap, and streams text deltas while `saveState` keeps SQLite current.
