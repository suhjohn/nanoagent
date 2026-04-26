# Model Routing

Pick which model handles each turn based on durable context.

## The problem

Routing decisions belong to caller code, not kernel. But routing needs to be deterministic across resumes: if a run pauses on turn 3 and resumes in another process tomorrow, it must pick the same model. Anything the router reads must live in `AgentRunState.context`, which kernel serializes.

## The pattern

`onTurnPrepared` reads context and returns `{ model, messages }`. Model strings resolve through `modelProviders`, so a route like `enterprise-gateway/claude-opus-4-7` can target a dedicated provider with its own credentials and gateway URL.

This example shows two routing strategies:

**Per-turn routing** (`perTurnHooks`). Turn 1 uses the strongest model (`claude-opus-4-7`) to lock in a high-quality plan. Later turns pick by `context.complexity`, which `classifyPrompt` writes once when the run starts. Resume reads the same classification.

**Per-tenant routing** (`tenantHooks`). Fresh runs call `loadTenant` once and serialize `tenantId` and `tenantTier` into context. The router maps tier (`free`, `pro`, `enterprise`) to a model and gateway. Resumed runs never re-fetch the tenant: the tier is already in context.

## Source

See [src/index.ts](./src/index.ts).

## Check

```sh
bun run typecheck
```
