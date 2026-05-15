import { randomUUID } from "node:crypto";
import { runInteractiveCli } from "../../common-cli/src";
import { runSkipProtected, type Context } from "./index";

const baseRunId = process.env.RUN_ID ?? `skip-cli-${randomUUID()}`;

await runInteractiveCli({
  defaultPrompt: "/private/secret.txt",
  intro: "Skip protected tool example. Enter path model should try to delete.",
  run: async ({ input, cli }) => {
    const runId = `${baseRunId}-${Date.now()}`;

    const initialContext: Context = {
      messages: [
        {
          role: "system",
          content: "You are testing tool policy. If a tool result says blocked, explain that the delete was blocked by policy.",
        },
        {
          role: "user",
          content: `Call deleteFile with {"path":"${input}"} and then explain the result.`,
        },
      ],
    };

    const { context, status } = await runSkipProtected({
      deps: { streamToClient: (event) => cli.event(event) },
      runId,
      context: initialContext,
    });

    const toolCalls = context.messages
      .flatMap(m => m.role === "tool" && Array.isArray(m.content) ? m.content : []);
    const deleteResult = toolCalls.find((c: any) => c.toolName === "deleteFile")?.result;

    cli.json({
      blocked: deleteResult?.blocked,
      reason: deleteResult?.reason,
      finalStatus: status?.type,
    });
  },
});
