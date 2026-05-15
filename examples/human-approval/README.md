# Human Approval

**Pause for a human. Resume hours later. Same hook handles both ends.**

## What this showcases

Sensitive tool calls — charging a card, sending an email, deleting a record — need a human in the loop. The agent should freeze on the exact tool call, surface the decision to wherever humans live, then continue when approval arrives.

Kernel makes this one hook with one branch.

## The pattern

`onToolCallStarted` runs twice for the same call: once before approval (pauses the run), once after approval (lets it through). State stays durable in between.

**Pause path**

1. `onToolCallStarted` sees `toolName === "ChargeCard"` and checks `context.approvedToolCallIds`.
2. Call id is not approved. Hook returns `{ control: { type: "pause", reason: "approval_required", metadata: { toolCallId, toolName } } }`.
3. Kernel commits a `pause` event. Pending tool call stays in saved state.

**Resume path**

1. The caller loads state, adds `toolCallId` to `context.approvedToolCallIds`, saves, then calls `runAgent` again.
2. Kernel clears the pause marker and re-enters `onToolCallStarted` for the same call.
3. Hook sees the id in `context.approvedToolCallIds` and returns nothing. Tool runs.

One hook, both directions. Adding a tool to the gate is one new branch.

## Try it

```sh
bun run start
```

The CLI posts a pending `ChargeCard` approval and waits. Type `/approve` to approve the latest paused run, execute the tool, and resume the model.

## Source

See [src/index.ts](./src/index.ts).

## Check

```sh
bun run typecheck
```