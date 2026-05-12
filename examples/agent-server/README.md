# Agent Server

Durable agent server backed by Postgres, with resumable runs, per-session memory, and steering through queued user input.

## What this shows

This example wires durable state, steering, and streamed HTTP responses with Drizzle and Express.

Each chat session owns:

- One `agent_sessions` row (session metadata).
- Ordered `agent_messages` rows (caller-owned conversation memory).
- An `agent_inbox` steering queue for user messages waiting for the next turn.
- One `agent_runs` row per streamed response, with an append-only `agent_events` stream.

Steering is how callers direct the next model turn while a session stays durable. User input lands in `agent_inbox`; `onTurnPrepared` promotes queued steering messages into conversation memory before each turn. `onTurnCompleted` returns `continue` only if more steering arrived during the turn, so one run drains queued input without spawning duplicate runs.

## Source

- [src/db.ts](./src/db.ts): Drizzle tables, schema creation, persistence helpers.
- [src/agent.ts](./src/agent.ts): kernel hook wiring, steering flush, conditional turn continuation.
- [src/server.ts](./src/server.ts): Express chat routes.

## Tables

Create the Drizzle database from a connection string, then call `createSchema(db)` once. Production apps should manage the schema with Drizzle migrations instead.

```ts
const db = createDb(process.env.DATABASE_URL!);
await createSchema(db);
```

The schema stores:

- `agent_sessions`: chat session metadata.
- `agent_inbox`: incoming steering messages waiting for next turn.
- `agent_runs`: latest durable `AgentRunState` per streamed response.
- `agent_events`: committed phase events by `run_id`, `revision`, and `ordinal`.
- `agent_messages`: caller-owned conversation memory per session.

## Routes

`GET /session` lists sessions.

`POST /session` creates a session.

```json
{
  "userId": "user_42",
  "title": "Project brief",
  "model": "openai/gpt-5.4-mini"
}
```

`POST /session/:id/message` steers session by enqueueing user input, resumes saved agent state, and streams model response over SSE. Each kernel stream event is sent with `event: <type>`. The stream ends with `message_completed`, then `done`.

```json
{
  "content": "Write concise project brief."
}
```

```sh
curl -N \
  -H 'Content-Type: application/json' \
  -d '{"content":"Write concise project brief."}' \
  http://localhost:3000/session/session_123/message
```

## Run

CLI:

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/nano \
  bun run start "Explain the agent server in one sentence."
```

Server:

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/nano bun run server
```

Both commands use real providers from `packages/kernel/.env`. Set `MODEL` to override `openai/gpt-5.4-mini`.

## App

```ts
import { createApp, createDb, createSchema } from "./src";

const db = createDb(process.env.DATABASE_URL!);
await createSchema(db);

createApp({
  db,
  defaultModel: "openai/gpt-5.4-mini",
}).listen(3000);
```

## Direct Agent Run

Routes steer the agent by enqueueing user input before running it. Non-HTTP callers use the same steering path explicitly.

```ts
await enqueueUserMessage(db, {
  id: crypto.randomUUID(),
  sessionId: "session_123",
  content: "Write concise project brief.",
});

await runSessionAgent({
  db,
  runId: crypto.randomUUID(),
  sessionId: "session_123",
  userId: "user_42",
  model: "openai/gpt-5.4-mini",
});
```

Use a new `runId` for each streamed response. Reuse a `runId` only to resume interrupted processing of the same response.

## Check

```sh
bun run typecheck
```
