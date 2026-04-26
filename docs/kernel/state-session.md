# Session state

Session state is caller-owned continuity across runs.

`@nanoagent/kernel` does not define session storage, transcript storage, memory, user preferences, retrieval state, UI state, or product-specific task state. Caller code chooses those shapes and decides where they live.

Kernel carries typed `context extends JsonLike` inside `AgentRunState`. Hooks can return updated `context`, and `saveState` can persist resulting run snapshot. `context` is durable JSON-like bridge between caller session model and kernel run loop.

## Ownership

Caller owns:

- Conversation transcript and summaries.
- User, workspace, or task metadata.
- Long-lived memory and retrieval pointers.
- Mapping from session IDs to run IDs.
- Assembly of future model messages from transcript, summaries, memory, retrieved context, and completed turns.

Kernel owns:

- Current run lifecycle.
- Completed and current turn execution snapshots in `state.turns` and `state.currentTurn`.
- Pause, resume, completion, and failure state.
- Events emitted while one run advances.

## What This Enables

Caller-owned session state lets clients decide what "conversation continuity" means for their product.

Chat clients can make long conversations feel continuous without putting entire transcript in kernel state. They can store messages, summaries, attachments, and preferences in their own session model, then hand kernel only enough context to run next turn.

Support and ops clients can preserve business context across many agent runs. One customer case may contain prior tickets, account metadata, escalation state, and audit history while each agent run stays focused on current task.

Coding-agent clients can keep workspace state outside run loop. Repository root, branch, changed files, task plan, approval records, and terminal history can live in product storage while kernel only tracks execution position.

Human-in-the-loop clients can pause run and continue hours later. Product owns approval request, notification channel, reviewer identity, and approval result; kernel owns paused tool-call position.

Realtime clients can stream aggressively without making stream delivery persistence model. UI can store partial output for reconnect replay, or treat stream as ephemeral and rely on committed run state for correctness.

Multi-agent clients can share one session across many runs. Planner, researcher, executor, and reviewer runs can share memory and task metadata while keeping separate `AgentRunState` records.

The abstraction matters because run state answers "where is this execution?", while session state answers "what does client experience remember?" Different products need different answers, and kernel does not force one storage model.

## Model Input Boundary

`onTurnPrepared` is where session state becomes model input.

Kernel stores completed turns in `state.turns`, including model responses and completed tool calls. Kernel does not maintain transcript and does not append previous assistant or tool messages to future requests.

Caller code loads transcript, summaries, memory, retrieved context, hidden instructions, and any messages derived from completed turns, then returns exact model input for current turn from `onTurnPrepared`.

```ts
const hooks: AgentHooks<Context> = {
  onTurnPrepared: ({ context }) => ({
    value: {
      model: "openai/gpt-5-nano",
      messages: loadMessagesForSession(context.sessionId),
    },
  }),
  onTurnCompleted: ({ context, turn }) => {
    appendCompletedTurn(context.sessionId, turn);
  },
};
```

## Contrast With Run State

Session state answers: what does this agent remember across runs?

Run state answers: where is this one run in kernel execution right now?
