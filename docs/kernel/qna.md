# Q&A

## What happens when model finish reason is not `tool-calls`?

Kernel completes current turn, then completes run as `model_done` unless caller explicitly continues.

Model result becomes `state.currentTurn.modelResult`. Tool snapshot is empty:

```ts
toolCalls: {
  pending: [],
  inFlight: [],
  completed: [],
}
```

Main loop sees `model_completed` with no pending tool calls and calls `completeTurn`.

After `turn_completed`, loop checks:

- `maxTurns`: complete run as `max_turns`.
- `onTurnCompleted` returned `control: { type: "continue" }`: start next turn.
- no completed tool calls: complete run as `model_done`.

So plain model completion ends run by default. Use `onTurnCompleted` with `continue` when product wants another turn after non-tool response.

```ts
const hooks: AgentHooks<Context> = {
  onTurnCompleted: ({ turn }) => {
    if (shouldRunAnotherTurn(turn)) {
      return {
        control: {
          type: "continue",
        },
      };
    }
  },
};
```
