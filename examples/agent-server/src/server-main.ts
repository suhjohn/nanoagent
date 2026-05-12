import { startServer } from "./server";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for agent-server.");
}

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`invalid PORT: ${process.env.PORT}`);
}

await startServer({
  databaseUrl,
  defaultModel: process.env.MODEL ?? "openai/gpt-5.4-mini",
  port,
});

console.log(`agent-server listening on http://localhost:${port}`);
