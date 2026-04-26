# Examples

Examples live as private TypeScript packages under `examples/`. Each package has `package.json`, `tsconfig.json`, `README.md`, and source entrypoint. Each package imports `@nanoagent/kernel`; local checks map it to `file:../../packages/kernel`.

- [Compact](../../examples/compact/README.md): caller-owned conversation memory, compaction in `onTurnPrepared`, assistant memory append in `onTurnCompleted`, durable `AgentRunState` persistence.
- [Fallback model retry](../../examples/fallback-model-retry/README.md): `callModel` middleware, retryable provider error detection, fallback model selection through `modelProviders`.
- [Human approval](../../examples/human-approval/README.md): `onToolCallStarted` pause control for sensitive tools, `saveState` side effects after committed pause events, resume after caller-owned approval context changes.
- [Idempotent tool replay](../../examples/idempotent-tool-replay/README.md): safe recovery from interrupted tool execution by replaying externally idempotent `inFlight` tool calls with Kernel `toolCallId`.
- [Model routing](../../examples/model-routing/README.md): deterministic model selection from serialized context in `onTurnPrepared`, including per-turn and per-tenant routing.
- [Postgres simple agent](../../examples/postgres-simple-agent/README.md): durable sessions, inbox, run state, event stream, caller-owned message memory, and streamed Express routes backed by Drizzle and Postgres.

Run example checks from package directory:

```sh
bun run typecheck
```

Run all current examples from repo root:

```sh
for example in examples/*; do (cd "$example" && bun run typecheck); done
```
