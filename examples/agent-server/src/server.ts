import { randomUUID } from "node:crypto";
import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from "express";
import type { ModelMessage } from "ai";
import type { AgentModelProviders, AgentStreamEvent } from "@nanoagent/kernel";
import {
  createDb,
  createSchema,
  createSession,
  enqueueUserMessage,
  type Db,
  getSession,
  listSessions,
  loadMessages,
  touchSession,
} from "./db";
import { runSessionAgent } from "./agent";

const DEFAULT_MODEL = "openai/gpt-5.4-mini";

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;
type MessageSseEvent =
  | AgentStreamEvent
  | {
      type: "message_completed";
      runId: string;
      session: Session;
      messages: ModelMessage[];
    }
  | { type: "error"; error: string }
  | { type: "done" };

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function requireString(body: unknown, key: string) {
  if (
    typeof body === "object" &&
    body !== null &&
    key in body &&
    typeof body[key as keyof typeof body] === "string"
  ) {
    return body[key as keyof typeof body] as string;
  }

  throw new HttpError(400, `missing string body field: ${key}`);
}

function sendSse(res: Response, event: MessageSseEvent) {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function optionalString(body: unknown, key: string) {
  if (typeof body !== "object" || body === null || !(key in body)) return;

  const value = body[key as keyof typeof body];
  if (typeof value === "string") return value;
  throw new HttpError(400, `body field must be string: ${key}`);
}

export function createApp(params: {
  db: Db;
  defaultModel?: string;
  modelProviders?: AgentModelProviders;
}) {
  const app = express();
  app.use(express.json());

  app.get("/session", async (_req: Request, res: Response) => {
    res.json({ sessions: await listSessions(params.db) });
  });

  app.post("/session", async (req: Request, res: Response) => {
    const session = await createSession(params.db, {
      id: randomUUID(),
      model:
        optionalString(req.body, "model") ??
        params.defaultModel ??
        DEFAULT_MODEL,
      title: optionalString(req.body, "title"),
      userId: requireString(req.body, "userId"),
    });

    res.status(201).json({ session });
  });

  app.post("/session/:id/message", async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    if (typeof sessionId !== "string") {
      throw new HttpError(400, "missing session id");
    }

    const session = await getSession(params.db, sessionId);
    if (!session) throw new HttpError(404, "session not found");

    const runId = randomUUID();
    await enqueueUserMessage(params.db, {
      id: randomUUID(),
      sessionId: session.id,
      content: requireString(req.body, "content"),
    });

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      await runSessionAgent({
        db: params.db,
        model: session.model,
        modelProviders: params.modelProviders,
        runId,
        sessionId: session.id,
        streamToClient: (event) => sendSse(res, event),
        userId: session.userId,
      });
      await touchSession(params.db, session.id);

      sendSse(res, {
        type: "message_completed",
        runId,
        session: (await getSession(params.db, session.id)) ?? session,
        messages: await loadMessages(params.db, session.id),
      });
      sendSse(res, { type: "done" });
      res.end();
    } catch (error) {
      sendSse(res, {
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      res.end();
    }
  });

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error instanceof HttpError ? error.status : 500;
    res.status(status).json({
      error: error instanceof Error ? error.message : String(error),
    });
  };
  app.use(errorHandler);

  return app;
}

export async function startServer(params: {
  databaseUrl: string;
  defaultModel?: string;
  modelProviders?: AgentModelProviders;
  port?: number;
}) {
  const db = createDb(params.databaseUrl);
  await createSchema(db);

  return createApp({
    db,
    defaultModel: params.defaultModel,
    modelProviders: params.modelProviders,
  }).listen(params.port ?? 3000);
}
