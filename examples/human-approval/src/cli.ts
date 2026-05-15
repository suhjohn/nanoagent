import { randomUUID } from "node:crypto";
import { type InteractiveCli, runInteractiveCli } from "../../common-cli/src";
import { runHumanApproval, type Context } from "./index";

const baseRunId = process.env.RUN_ID ?? `approval-cli-${randomUUID()}`;

// In-memory store
const states = new Map<string, { context: Context, status: any }>();
let activeRunId: string | undefined;

await runInteractiveCli({
  defaultPrompt: "Charge the customer card $1.00 in USD, then confirm the result.",
  intro: "Human approval example.",
  commands: {
    approve: {
      description: "Approve latest pending tool request",
      run: async ({ cli }) => {
        await approveLatest(cli);
      },
    },
  },
  run: async ({ input, cli }) => {
    activeRunId = baseRunId;
    const initialContext: Context = {
      approvedToolCallIds: [],
      messages: [{ role: "user", content: input }],
    };
    
    const { context, status } = await runHumanApproval({
      deps: { streamToClient: (event) => cli.event(event) },
      runId: activeRunId,
      context: initialContext,
    });
    
    states.set(activeRunId, { context, status });

    if (status?.type === "paused") {
      cli.info("Run paused for approval. Use /approve to continue.");
    }
  },
});

async function approveLatest(cli: InteractiveCli) {
  if (!activeRunId) {
    cli.info("No active run.");
    return;
  }

  const saved = states.get(activeRunId);
  if (saved?.status?.type !== "paused") {
    cli.info("No pending approval.");
    return;
  }

  // Find the tool call ID that needs approval
  // In a real app, this comes from the pause event metadata saved to DB
  const unapprovedId = saved.context.messages
    .flatMap(m => m.role === "assistant" && typeof m.content !== "string" ? m.content : [])
    .filter((c: any) => c.type === "tool-call" && c.toolName === "ChargeCard")
    .map((c: any) => c.toolCallId)
    .find(id => !saved.context.approvedToolCallIds.includes(id));

  if (!unapprovedId) {
    cli.info("Could not find unapproved tool call.");
    return;
  }

  // Approve it
  saved.context.approvedToolCallIds = [...saved.context.approvedToolCallIds, unapprovedId];
  cli.info(`Approved tool call ${unapprovedId}`);

  // Resume
  const { context, status } = await runHumanApproval({
    deps: { streamToClient: (event) => cli.event(event) },
    runId: activeRunId,
    context: saved.context,
  });
  
  states.set(activeRunId, { context, status });
}
