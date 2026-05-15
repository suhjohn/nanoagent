import { randomUUID } from "node:crypto";
import { runInteractiveCli } from "../../common-cli/src";
import { startOrResume, type ChargeResult, type Context } from "./index";

const baseRunId = process.env.RUN_ID ?? `replay-cli-${randomUUID()}`;
const customerId = "cust_123";

await runInteractiveCli({
  defaultPrompt: "Charge the customer card $1.00 in USD, then confirm the result.",
  intro: "Idempotent tool replay example.",
  run: async ({ input, cli }) => {
    let runs = 0;
    const runId = `${baseRunId}-${++runs}`;
    let controller = new AbortController();

    const seenCharges = new Map<string, ChargeResult>();
    let networkAttempts = 0;

    const chargeGateway = {
      createCharge: async (params: { idempotencyKey: string; amountCents: number }): Promise<ChargeResult> => {
        networkAttempts++;
        const cached = seenCharges.get(params.idempotencyKey);
        
        if (cached) {
          cli.info(`[Gateway] Returning cached charge for ${params.idempotencyKey}`);
          return cached;
        }

        cli.info(`[Gateway] Creating new charge for ${params.idempotencyKey}`);
        const result: ChargeResult = {
          chargeId: `ch_${seenCharges.size + 1}`,
          status: "succeeded",
        };
        seenCharges.set(params.idempotencyKey, result);

        // Simulate network failure ONLY on the first attempt
        if (networkAttempts === 1) {
          cli.info(`[Gateway] Simulating network drop after charge acceptance!`);
          controller.abort(new Error("payment network dropped response after charge accepted"));
        }
        
        return result;
      },
    };

    const deps = {
      chargeGateway,
      streamToClient: (event: any) => cli.event(event),
    };

    const initialContext: Context = {
      customerId,
      messages: [{ role: "user", content: input }],
    };

    cli.info("--- ATTEMPT 1 ---");
    let stateResult: any;
    try {
      stateResult = await startOrResume({
        deps,
        state: { runId, context: initialContext },
        signal: controller.signal,
      });
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      cli.info(`network_response_lost attempt=1`);
    }

    if (!stateResult || stateResult.status.type !== "completed") {
      cli.info("\n--- RESUMING AFTER FAILURE ---");
      // Create a new controller for the resume
      controller = new AbortController();
      stateResult = await startOrResume({
        deps,
        state: stateResult!, // pass the aborted state which has the in-flight tool call
        signal: controller.signal,
      });
    }

    cli.json({
      chargesCreated: seenCharges.size,
      networkAttempts,
      finalStatus: stateResult?.status,
    });
  },
});
