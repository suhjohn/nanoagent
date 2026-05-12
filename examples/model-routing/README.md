# Model Routing

Pick which model handles each turn based on durable context.

## The problem

Routing decisions belong to caller code, not kernel. But routing needs to be deterministic across resumes: if a run pauses on turn 3 and resumes in another process tomorrow, it must pick the same model. Anything the router reads must live in `AgentRunState.context`, which kernel serializes.

## The pattern

`onTurnPrepared` reads context and returns `{ model, messages }`. Model strings resolve through `modelProviders`, so a route like `openai/gpt-5.4-mini` can target a dedicated provider with its own credentials and gateway URL.

This example shows two routing strategies:

**Per-turn routing** (`perTurnHooks`). Turn 1 and later turns use `openai/gpt-5.4-mini` by default in this runnable example. The routing decision still reads durable `context.complexity`, so callers can swap in different model strings without changing the resume contract.

**Per-tenant routing** (`tenantHooks`). Fresh runs call `loadTenant` once and serialize `tenantId` and `tenantTier` into context. The router maps tier (`free`, `pro`, `enterprise`) to a model and gateway. Resumed runs never re-fetch the tenant: the tier is already in context.

## Source

See [src/index.ts](./src/index.ts).

## Run

```sh
bun run start "Explain model routing in one sentence."
```

The CLI runs both per-turn and per-tenant routing with real providers from `packages/kernel/.env`.

## Check

```sh
bun run typecheck
```
