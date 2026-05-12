import type { ModelMessage } from "ai";
import { asc, desc, eq, sql } from "drizzle-orm";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type {
  AgentRunState,
  AgentSaveState,
  JsonLike,
} from "@nanoagent/kernel";

export type RunContext = {
  [key: string]: JsonLike;
  model: string;
  sessionId: string;
  userId: string;
};

export type SessionContext = ModelMessage[];

type MessageRole = "system" | "user" | "assistant" | "tool";
type StoredEvent = Parameters<AgentSaveState<RunContext>>[0]["events"][number];

export const agentSessions = sqliteTable("agent_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  model: text("model").notNull(),
  context: text("context", { mode: "json" }).$type<SessionContext>().notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  revision: integer("revision").notNull(),
  state: text("state", { mode: "json" })
    .$type<AgentRunState<RunContext>>()
    .notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const agentEvents = sqliteTable("agent_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull(),
  revision: integer("revision").notNull(),
  ordinal: integer("ordinal").notNull(),
  type: text("type").notNull(),
  payload: text("payload", { mode: "json" }).$type<StoredEvent>().notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const agentMessages = sqliteTable("agent_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  runId: text("run_id"),
  role: text("role").$type<MessageRole>().notNull(),
  message: text("message", { mode: "json" }).$type<ModelMessage>().notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const schema = {
  agentEvents,
  agentMessages,
  agentRuns,
  agentSessions,
};

export type Db = BunSQLiteDatabase<typeof schema>;

export function createDb(path = "compact.sqlite") {
  return drizzle(path, { schema });
}

export function createSchema(db: Db) {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      model text NOT NULL,
      context text NOT NULL,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      revision integer NOT NULL,
      state text NOT NULL,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS agent_events (
      id integer PRIMARY KEY AUTOINCREMENT,
      run_id text NOT NULL,
      revision integer NOT NULL,
      ordinal integer NOT NULL,
      type text NOT NULL,
      payload text NOT NULL,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (run_id, revision, ordinal)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS agent_messages (
      id integer PRIMARY KEY AUTOINCREMENT,
      session_id text NOT NULL,
      run_id text,
      role text NOT NULL,
      message text NOT NULL,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export function createSession(
  db: Db,
  params: {
    id: string;
    model: string;
    userId: string;
  },
) {
  const context = [] satisfies SessionContext;
  const rows = db
    .insert(agentSessions)
    .values({
      id: params.id,
      model: params.model,
      userId: params.userId,
      context,
    })
    .returning()
    .all();

  const session = rows[0];
  if (!session) throw new Error(`failed to create session: ${params.id}`);
  return session;
}

export function listSessions(db: Db) {
  return db
    .select()
    .from(agentSessions)
    .orderBy(desc(agentSessions.updatedAt))
    .all();
}

export function getSession(db: Db, id: string) {
  const rows = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, id))
    .limit(1)
    .all();

  return rows[0];
}

export function loadSessionContext(db: Db, sessionId: string) {
  const session = getSession(db, sessionId);
  if (!session) throw new Error(`missing session: ${sessionId}`);
  return session.context;
}

export function saveSessionContext(
  db: Db,
  params: { context: SessionContext; sessionId: string },
) {
  db.update(agentSessions)
    .set({
      context: params.context,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(agentSessions.id, params.sessionId))
    .run();
}

export function loadState(db: Db, runId: string) {
  const rows = db
    .select({ state: agentRuns.state })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1)
    .all();

  return rows[0]?.state;
}

export function makeSaveState(db: Db): AgentSaveState<RunContext> {
  return ({ state, events }) => {
    db.transaction((tx) => {
      const result = tx
        .insert(agentRuns)
        .values({
          id: state.runId,
          sessionId: state.context.sessionId,
          revision: state.revision,
          state,
        })
        .onConflictDoUpdate({
          target: agentRuns.id,
          set: {
            revision: state.revision,
            state,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
          setWhere: eq(agentRuns.revision, state.revision - 1),
        })
        .returning({ id: agentRuns.id })
        .all();
      if (result.length !== 1) {
        throw new Error(`stale agent run revision: ${state.runId}`);
      }

      for (const [ordinal, event] of events.entries()) {
        tx.insert(agentEvents)
          .values({
            runId: state.runId,
            revision: state.revision,
            ordinal,
            type: event.type,
            payload: event,
          })
          .onConflictDoNothing({
            target: [
              agentEvents.runId,
              agentEvents.revision,
              agentEvents.ordinal,
            ],
          })
          .run();
      }
    });
  };
}

export function loadMessages(db: Db, sessionId: string) {
  const rows = db
    .select({ message: agentMessages.message })
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(asc(agentMessages.id))
    .all();

  return rows.map((row) => row.message);
}

export function appendMessages(
  db: Db,
  params: {
    messages: readonly ModelMessage[];
    runId?: string;
    sessionId: string;
  },
) {
  for (const message of params.messages) {
    db.insert(agentMessages)
      .values({
        sessionId: params.sessionId,
        runId: params.runId,
        role: "role" in message ? (message.role as MessageRole) : "assistant",
        message,
      })
      .run();
  }
}

export function appendContextMessages(
  db: Db,
  params: {
    messages: readonly ModelMessage[];
    sessionId: string;
  },
) {
  const context = loadSessionContext(db, params.sessionId);
  saveSessionContext(db, {
    sessionId: params.sessionId,
    context: [...context, ...params.messages],
  });
}
