import { randomUUID } from "node:crypto";
import {
  createDb,
  createSchema,
  createSession,
  enqueueUserMessage,
  loadMessages,
} from "./db";
import { runSessionAgent } from "./agent";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for agent-server.");
}

const model = process.env.MODEL ?? "openai/gpt-5.4-mini";
const prompt =
  process.argv.slice(2).join(" ") ||
  "Reply with one concise sentence explaining the agent server.";
const db = createDb(databaseUrl);
const sessionId = process.env.SESSION_ID ?? `session-${randomUUID()}`;
const runId = process.env.RUN_ID ?? `run-${randomUUID()}`;

await createSchema(db);
await createSession(db, {
  id: sessionId,
  model,
  title: "CLI run",
  userId: process.env.USER_ID ?? "user_42",
});
await enqueueUserMessage(db, {
  id: randomUUID(),
  sessionId,
  content: prompt,
});

await runSessionAgent({
  db,
  model,
  runId,
  sessionId,
  streamToClient: (event) => {
    console.log(event.type);
  },
  userId: process.env.USER_ID ?? "user_42",
});

console.log(
  JSON.stringify(
    {
      messages: (await loadMessages(db, sessionId)).length,
      runId,
      sessionId,
    },
    null,
    2,
  ),
);
process.exit(0);
