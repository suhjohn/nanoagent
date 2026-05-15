# Idempotent Tool Replay

**Lose network response after payment. Resume without double-charging.**

## What this showcases

When a network response disappears between starting a tool call and committing its result, the saved state holds an `inFlight` tool call. Kernel refuses to auto-resume: the external side effect — a charge, an email, a write — might already have happened. Replaying blindly could double it.

Some tools fix this at the API: pass an idempotency key, and replay returns the original result instead of running again. This example shows how to opt in to safe replay, per tool.

## Kernel boundary

Kernel records exact tool progress. If a saved run still has `currentTurn.toolCalls.inFlight`, kernel does not decide whether the side effect happened. Resuming that state unchanged throws `Cannot safely resume while tool calls are in flight.`

Caller owns recovery policy before calling `runAgent` again:

- Leave state unchanged when tool outcome is unknown. Kernel stops.
- Move replay-safe calls from `inFlight` to `pending`. Kernel executes them again with same `toolCallId`.

This example chooses replay only for `ChargeCard`, because the payment gateway treats `toolCallId` as the idempotency key.

## The pattern

`ChargeCard` passes the kernel's `toolCallId` as the payment gateway's `idempotencyKey`. Same key, same charge. Replay is safe end-to-end.

Before resume, `replayIdempotentChargeCalls` inspects saved state:

- Every in-flight call is `ChargeCard`: rewrite calls from `inFlight` back to `pending`, set phase to `tool_call_started`. Kernel re-executes; the gateway returns the original charge.
- Any in-flight call lacks the replay guarantee: leave state unchanged. Kernel throws `Cannot safely resume while tool calls are in flight.`

## Try it

```sh
bun run start "Charge $1.00"
```

## Source

See [src/index.ts](./src/index.ts).

## Check

```sh
bun run typecheck
```