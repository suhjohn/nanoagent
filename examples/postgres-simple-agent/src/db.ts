import type { ModelMessage } from "ai";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  bigserial,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import pg from "pg";
import type { AgentRunState, AgentSaveState, JsonLike } from "@nanoagent/kernel";

export type Context = {
  [key: string]: JsonLike;
  sessionId: string;
  userId: string;
};

type StoredEvent = Parameters<AgentSaveState<Context>>[0]["events"][number];
type MessageRole = "system" | "user" | "assistant" | "tool";

export const agentSessions = pgTable("agent_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  model: text("model").notNull(),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const agentRuns = pgTable("agent_runs", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull(),
  state: jsonb("state").$type<AgentRunState<Context>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const agentEvents = pgTable(
  "agent_events",
  {
    runId: text("run_id").notNull(),
    revision: integer("revision").notNull(),
    ordinal: integer("ordinal").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<StoredEvent>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.runId, table.revision, table.ordinal],
    }),
  ],
);

export const agentInbox = pgTable("agent_inbox", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  ordinal: bigserial("ordinal", { mode: "number" }).notNull(),
  message: jsonb("message").$type<ModelMessage>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const agentMessages = pgTable(
  "agent_messages",
  {
    sessionId: text("session_id").notNull(),
    ordinal: bigserial("ordinal", { mode: "number" }).notNull(),
    role: text("role").$type<MessageRole>().notNull(),
    message: jsonb("message").$type<ModelMessage>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.sessionId, table.ordinal],
    }),
  ],
);

export const schema = {
  agentEvents,
  agentInbox,
  agentMessages,
  agentRuns,
  agentSessions,
};

export type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type RunnableDb = Db | Tx;

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return drizzle(pool, { schema });
}

export async function createSchema(db: Db) {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      model text NOT NULL,
      title text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id text PRIMARY KEY,
      revision integer NOT NULL,
      state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_events (
      run_id text NOT NULL,
      revision integer NOT NULL,
      ordinal integer NOT NULL,
      type text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (run_id, revision, ordinal)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_inbox (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      ordinal bigserial NOT NULL,
      message jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_messages (
      session_id text NOT NULL,
      ordinal bigserial NOT NULL,
      role text NOT NULL,
      message jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (session_id, ordinal)
    )
  `);
}

export async function createSession(
  db: RunnableDb,
  params: { id: string; model: string; title?: string; userId: string },
) {
  const rows = await db
    .insert(agentSessions)
    .values({
      id: params.id,
      model: params.model,
      title: params.title,
      userId: params.userId,
    })
    .returning();

  const session = rows[0];
  if (!session) throw new Error(`failed to create session: ${params.id}`);
  return session;
}

export async function listSessions(db: RunnableDb) {
  return db.select().from(agentSessions).orderBy(desc(agentSessions.updatedAt));
}

export async function getSession(db: RunnableDb, id: string) {
  const rows = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, id))
    .limit(1);

  return rows[0];
}

export async function touchSession(db: RunnableDb, id: string) {
  await db
    .update(agentSessions)
    .set({ updatedAt: sql`now()` })
    .where(eq(agentSessions.id, id));
}

export async function loadState(db: RunnableDb, runId: string) {
  const rows = await db
    .select({ state: agentRuns.state })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1);

  return rows[0]?.state;
}

async function saveRunState(tx: Tx, state: AgentRunState<Context>) {
  const rows = await tx
    .insert(agentRuns)
    .values({
      id: state.runId,
      revision: state.revision,
      state,
    })
    .onConflictDoUpdate({
      target: agentRuns.id,
      set: {
        revision: state.revision,
        state,
        updatedAt: sql`now()`,
      },
      setWhere: eq(agentRuns.revision, state.revision - 1),
    })
    .returning({ id: agentRuns.id });

  if (rows.length !== 1) {
    throw new Error(`stale agent run revision: ${state.runId}`);
  }
}

async function appendEvents(
  tx: Tx,
  state: AgentRunState<Context>,
  events: readonly StoredEvent[],
) {
  for (const [ordinal, event] of events.entries()) {
    await tx
      .insert(agentEvents)
      .values({
        runId: state.runId,
        revision: state.revision,
        ordinal,
        type: event.type,
        payload: event,
      })
      .onConflictDoNothing({
        target: [agentEvents.runId, agentEvents.revision, agentEvents.ordinal],
      });
  }
}

export function makeSaveState(db: Db): AgentSaveState<Context> {
  return async ({ state, events }) => {
    await db.transaction(async (tx) => {
      await saveRunState(tx, state);
      await appendEvents(tx, state, events);
    });
  };
}

export async function loadMessages(db: RunnableDb, sessionId: string) {
  const rows = await db
    .select({ message: agentMessages.message })
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(asc(agentMessages.ordinal));

  return rows.map((row) => row.message);
}

export async function enqueueUserMessage(
  db: RunnableDb,
  params: { content: string; id: string; sessionId: string },
) {
  const message = { role: "user", content: params.content } satisfies ModelMessage;
  await db.insert(agentInbox).values({
    id: params.id,
    sessionId: params.sessionId,
    message,
  });
  return message;
}

export async function flushInbox(db: Db, sessionId: string) {
  return db.transaction(async (tx) => {
    const inbox = await tx
      .select({ id: agentInbox.id, message: agentInbox.message })
      .from(agentInbox)
      .where(eq(agentInbox.sessionId, sessionId))
      .orderBy(asc(agentInbox.ordinal));

    if (inbox.length === 0) {
      return {
        flushed: false,
        messages: await loadMessages(tx, sessionId),
      };
    }

    await appendMessages(
      tx,
      sessionId,
      inbox.map((entry) => entry.message),
    );
    await tx.delete(agentInbox).where(
      inArray(
        agentInbox.id,
        inbox.map((entry) => entry.id),
      ),
    );

    return {
      flushed: true,
      messages: await loadMessages(tx, sessionId),
    };
  });
}

export async function hasInbox(db: RunnableDb, sessionId: string) {
  const rows = await db
    .select({ id: agentInbox.id })
    .from(agentInbox)
    .where(eq(agentInbox.sessionId, sessionId))
    .limit(1);

  return rows.length > 0;
}

export async function appendMessages(
  db: RunnableDb,
  sessionId: string,
  messages: readonly ModelMessage[],
) {
  for (const message of messages) {
    await db.insert(agentMessages).values({
      sessionId,
      role: "role" in message ? (message.role as MessageRole) : "assistant",
      message,
    });
  }
}
