# Model Routing

**Route model based on contextual logic.**

## What this showcases

Routing belongs in caller code, before you start the agent run. 

This example reads the user's subscription level, chooses the model, writes the selected model into `AgentRunState.context`, and then uses that model within `onTurnPrepared`.

## The pattern

- `getUserSubscriptionLevel(userId)` returns `free` or `pro`
- `selectModel(...)` maps `free` to `openai/gpt-5.4-mini`
- `selectModel(...)` maps `pro` to `openai/gpt-5.5`
- The selected model and reason are saved in `context`
- `onTurnPrepared` returns `context.selectedModel` to the kernel so it executes with that model

## Try it

```sh
bun run start "How do I upgrade to pro?"
```

No provider credentials required. `src/cli.ts` uses an inline demo model provider that streams deterministic text.

Try subscription levels:

```sh
SUBSCRIPTION_LEVEL=free bun run start "short prompt"
SUBSCRIPTION_LEVEL=pro bun run start "short prompt"
```

## Source

See [src/index.ts](./src/index.ts).

## Check

```sh
bun run typecheck
```