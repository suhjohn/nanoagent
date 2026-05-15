import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { runSessionAgent } from "./index";
import { randomUUID } from "crypto";
import type { SessionContext } from "@nanoagent/plugin";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

function makeModel(text = "Hello!") {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: text },
          { type: "text-end", id: "t1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            logprobs: undefined,
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
          },
        ],
      }),
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  });
}

function makeFsPersister(sessionPath: string) {
  return async ({ state }: { state: any; events: any[] }) => {
    await mkdir(dirname(sessionPath), { recursive: true });
    await writeFile(sessionPath, JSON.stringify(state.context, null, 2) + "\n");
  };
}

describe("runSessionAgent", () => {
  let dir: string;
  let sessionPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "session-test-"));
    sessionPath = join(dir, "session.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("persister writes to disk during the run, before run returns", async () => {
    let persisterCallCount = 0;
    let fileWrittenDuringRun = false;

    await runSessionAgent({
      runId: randomUUID(),
      prompt: "Hi there.",
      modelProvider: makeModel(),
      persister: async ({ state }) => {
        persisterCallCount++;
        await mkdir(dirname(sessionPath), { recursive: true });
        await writeFile(sessionPath, JSON.stringify(state.context, null, 2) + "\n");
        const contents = await readFile(sessionPath, "utf8");
        if (contents.length > 0) fileWrittenDuringRun = true;
      },
    });

    expect(persisterCallCount).toBeGreaterThan(0);
    expect(fileWrittenDuringRun).toBe(true);

    const saved = JSON.parse(await readFile(sessionPath, "utf8")) as SessionContext;
    const userMsg = saved.history.items.find((m: any) => m.role === "user") as any;
    const assistantMsg = saved.history.items.find((m: any) => m.role === "assistant") as any;

    expect(userMsg?.content).toContain("Hi there");
    expect(assistantMsg).toBeDefined();
  });

  test("history persists across runs via filesystem", async () => {
    const persister = makeFsPersister(sessionPath);

    // Turn 1
    await runSessionAgent({
      runId: randomUUID(),
      prompt: "My name is John.",
      modelProvider: makeModel("Got it, John!"),
      persister,
    });

    const savedAfterTurn1 = JSON.parse(await readFile(sessionPath, "utf8")) as SessionContext;
    expect(savedAfterTurn1.history.items.length).toBeGreaterThan(1);

    // Turn 2 — load from disk and continue
    await runSessionAgent({
      runId: randomUUID(),
      prompt: "What is my name?",
      sessionContext: savedAfterTurn1,
      modelProvider: makeModel("Your name is John."),
      persister,
    });

    const savedAfterTurn2 = JSON.parse(await readFile(sessionPath, "utf8")) as SessionContext;

    // History grew — both turns present
    expect(savedAfterTurn2.history.items.length).toBeGreaterThan(savedAfterTurn1.history.items.length + 1);
    // Turn 1 user message still in history
    expect(savedAfterTurn2.history.items.some((m: any) => m.content === "My name is John.")).toBe(true);
    // Turn 2 user message also in history
    expect(savedAfterTurn2.history.items.some((m: any) => m.content === "What is my name?")).toBe(true);
  });

  test("new run starts with empty history when no session is provided", async () => {
    const persister = makeFsPersister(sessionPath);

    await runSessionAgent({
      runId: randomUUID(),
      prompt: "Fresh start.",
      modelProvider: makeModel(),
      persister,
    });

    const saved = JSON.parse(await readFile(sessionPath, "utf8")) as SessionContext;
    expect(saved.history.items.length).toBe(2); // exactly user + assistant
    expect(saved.nextTurnIsFirst).toBe(false);
  });
});
