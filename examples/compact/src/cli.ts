import { randomUUID } from "node:crypto";
import {
  appendUserMessage,
  createDb,
  createSchema,
  createSession,
  loadMessages,
  loadSessionContext,
  runCompactAgent,
} from "./index";

const model = process.env.MODEL ?? "openai/gpt-5.4-mini";
const prompt =
  process.argv.slice(2).join(" ") ||
  "Reply with one concise sentence explaining token-based compaction.";
const db = createDb(process.env.SQLITE_PATH ?? "compact.sqlite");
const sessionId = process.env.SESSION_ID ?? "compact-session";
const runId = process.env.RUN_ID ?? randomUUID();

createSchema(db);
if (!createSessionIfMissing()) {
  console.log(`Using existing session: ${sessionId}`);
}

appendUserMessage({
  db,
  runId,
  sessionId,
  content: prompt,
});

await runCompactAgent({
  deps: {
    db,
    compact: async ({ messages, turnTotalTokens }) =>
      [
        `Previous context used ${turnTotalTokens} tokens on last turn.`,
        `Summarize these ${messages.length} older messages for future turns.`,
        JSON.stringify(messages),
      ].join("\n"),
    streamToClient: (event) => {
      console.log(event.type);
    },
  },
  model,
  policy: {
    compactAfterTurnTokens: Number(process.env.COMPACT_AFTER_TOKENS ?? 8_000),
    keepRecentMessages: Number(process.env.KEEP_RECENT_MESSAGES ?? 6),
  },
  runId,
  sessionId,
  userId: process.env.USER_ID ?? "user_42",
});

console.log(
  JSON.stringify(
    {
      contextMessages: loadSessionContext(db, sessionId).length,
      historyMessages: loadMessages(db, sessionId).length,
      runId,
      sessionId,
    },
    null,
    2,
  ),
);

function createSessionIfMissing() {
  try {
    createSession(db, {
      id: sessionId,
      model,
      userId: process.env.USER_ID ?? "user_42",
    });
    return true;
  } catch (error) {
    if (error instanceof Error && /constraint|unique/i.test(error.message)) {
      return false;
    }
    throw error;
  }
}
