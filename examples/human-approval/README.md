# Human Approval

Pause an agent before a sensitive tool runs, ask a human in Slack, then resume.

## The problem

Some tool calls (charge a card, send an email, delete a record) need human sign-off. The agent should stop, surface what it wants to do, wait for a decision, and continue if approved, possibly hours or days later, possibly in a different process.

## The pattern

Approval state lives in caller-owned context, not kernel state. Kernel handles the pause marker and keeps the pending tool call; caller orchestrates the approval round-trip.

**Pause path**:

1. `onToolCallStarted` sees `toolName === "ChargeCard"` and checks whether `toolCallId` is already in `context.approved`.
2. If not approved, returns `{ control: { type: "pause", reason: "approval_required", metadata: { toolCallId, toolName } } }`.
3. Kernel commits a `pause` event with that metadata. The tool call stays pending in saved state.
4. `saveState` writes the run, finds the pause event in the committed events, and posts a Slack message with the tool details.

**Resume path**:

1. Slack handler calls `approveFromSlack`, which loads state and adds `toolCallId` to `context.approved`.
2. Saves state, then calls the same `startOrResume`.
3. Kernel clears the pause marker and re-enters `onToolCallStarted` for the same call.
4. Hook sees the ID in `context.approved` and returns nothing. Tool runs.

The same hook handles both the pause and the resume. Adding a tool to the approval gate means adding one branch in `onToolCallStarted`.

## Source

See [src/index.ts](./src/index.ts).

## Run

```sh
bun run start "Run the approved charge and summarize the result."
```

The CLI seeds a pending `ChargeCard` tool call, pauses for approval, approves it, executes the tool, then resumes the model with real providers from `packages/kernel/.env`.

## Check

```sh
bun run typecheck
```
