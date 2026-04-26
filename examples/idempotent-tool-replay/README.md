# Idempotent Tool Replay

Resume an agent run that crashed mid-tool-call, without re-running the side effect.

## The problem

Kernel saves run state after each phase. If a process dies between starting a tool call and committing its result, saved state contains an `inFlight` tool call. Kernel refuses to auto-resume that state: the external side effect (charge, email, write) may have already happened, and re-running would double it.

## The pattern

Some tools are externally idempotent: replaying them with the same key returns the original result instead of running again. Caller code can opt in to replay for those tools.

`ChargeCard` in this example passes Kernel's `toolCallId` as the payment gateway's `idempotencyKey`. Same key always returns the same charge, so replay is safe end-to-end.

Before resume, `replayIdempotentChargeCalls` inspects saved state:

- Every in-flight call is `ChargeCard`: rewrite calls from `inFlight` back to `pending` and set phase to `tool_call_started`. Kernel re-executes the call; gateway returns the original charge.
- Any in-flight call lacks replay guarantee: leave state unchanged. Kernel throws `Cannot safely resume while tool calls are in flight.`

## Source

See [src/index.ts](./src/index.ts).

## Check

```sh
bun run typecheck
```
