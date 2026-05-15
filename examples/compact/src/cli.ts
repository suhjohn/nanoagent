import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInteractiveCli } from "../../common-cli/src";
import { runCompact, type Session } from "./index";

const sessionPath = process.env.SESSION_PATH ?? join(tmpdir(), `nano-compact-${randomUUID()}.json`);

async function loadSession(): Promise<Session> {
  const file = Bun.file(sessionPath);
  if (!(await file.exists())) {
    return { context: [], history: [] };
  }
  return (await file.json()) as Session;
}

async function saveSession(session: Session) {
  await mkdir(dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
}

await runInteractiveCli({
  defaultPrompt: "Reply with one concise sentence explaining token-based compaction.",
  intro: "Compact context example.",
  run: async ({ input, cli }) => {
    const session = await loadSession();

    const result = await runCompact({
      deps: {
        compactAfterTokens: Number(process.env.COMPACT_AFTER_TOKENS ?? 8_000),
        keepRecentMessages: Number(process.env.KEEP_RECENT_MESSAGES ?? 6),
        streamToClient: (event) => cli.event(event),
      },
      runId: randomUUID(),
      session,
      prompt: input,
    });

    await saveSession(result.session);
    cli.json({
      compacted: result.compacted,
      contextMessages: result.session.context.length,
      fullHistoryMessages: result.session.history.length,
      sessionPath,
    });
  },
});
