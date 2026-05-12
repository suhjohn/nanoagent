# Compact Transcript

Summarize older messages before they reach the model so long sessions stay under context limit.

## The problem

Long conversations outgrow the model's context window. Compaction replaces older messages with a summary while preserving recent messages verbatim. Caller code owns that memory policy.

## The pattern

SQLite stores sessions, runs, events, full message history, and current context. Drizzle owns the schema and queries.

Each session owns two message views:

- `agent_messages`: full append-only history across every run in the session.
- `agent_sessions.context`: exact current `ModelMessage[]` sent to the model.

Compaction changes session context only. Full history stays in `agent_messages`.

`onTurnPrepared` loads `agent_sessions.context` and returns the exact input for the next model call. `onTurnCompleted` reads that turn's committed LLM usage and compacts context when `totalUsage.totalTokens` crosses the policy threshold.

**Flow**:

- `appendUserMessage` appends user input to `agent_messages` and `agent_sessions.context`.
- `onTurnPrepared` loads session context and passes it to the model as-is.
- `onTurnCompleted` appends assistant messages to full history and current context.
- If that turn used at least `compactAfterTurnTokens`, `onTurnCompleted` summarizes context messages older than the last `keepRecentMessages` and saves `[summaryMessage, ...recentMessages]` back onto the session.

`CompactPolicy` controls the thresholds. Defaults: compact after a turn uses 8,000 total tokens, keep the last 6 messages verbatim. `compact` is injected as a dependency, so callers swap in their own summarizer (typically a smaller model).

## Tables

Call `createSchema(db)` once after creating the SQLite database.

```ts
import { createDb, createSchema } from "./src";

const db = createDb("compact.sqlite");
createSchema(db);
```

The schema stores:

- `agent_sessions`: session metadata and current context.
- `agent_runs`: latest durable `AgentRunState` per run.
- `agent_events`: committed phase events.
- `agent_messages`: full session message history.

## Run

CLI:

```sh
bun run start "Explain compacted session context in one sentence."
```

The CLI uses real providers from `packages/kernel/.env`. Set `SQLITE_PATH`, `SESSION_ID`, `MODEL`, `COMPACT_AFTER_TOKENS`, or `KEEP_RECENT_MESSAGES` to override defaults.

Library shape:

```ts
import {
  appendUserMessage,
  createDb,
  createSchema,
  createSession,
  runCompactAgent,
} from "./src";

const db = createDb("compact.sqlite");
createSchema(db);
createSession(db, {
  id: "session_123",
  model: "openai/gpt-5.4-mini",
  userId: "user_42",
});

appendUserMessage({
  db,
  sessionId: "session_123",
  content: "Write concise project brief.",
});

await runCompactAgent({
  deps: {
    db,
    compact: async ({ messages }) =>
      `Summarized ${messages.length} older messages.`,
    streamToClient: (event) => console.log(event.type),
  },
  runId: crypto.randomUUID(),
  sessionId: "session_123",
  userId: "user_42",
});
```

## Source

- [src/db.ts](./src/db.ts): SQLite Drizzle schema, session context, runs, events, full history.
- [src/index.ts](./src/index.ts): compact hook wiring.

## Check

```sh
bun run typecheck
```
