# nano-mono docs

Documentation for workspace packages.


## Packages

- [`@nanoagent/kernel`](./kernel/index.md): durable execution kernel for LLM agent runs.

## @nanoagent/kernel

`@nanoagent/kernel` exports `runAgent`, an `AsyncGenerator<AgentStreamEvent>` that advances one persisted run state machine. Work starts when caller iterates generator.

```sh
npm install @nanoagent/kernel
```

```ts
import { runAgent } from "@nanoagent/kernel";

for await (const event of runAgent<Context>({
  state,
  tools,
  modelProviders,
  hooks,
  maxTurns: 20,
  saveState,
  middleware,
  signal,
})) {
  await streamToClient(event);
}
```

This is it. It does a single run of agentic execution.

Kernel owns run phases, revisioned `AgentRunState`, pause/resume checkpoints, model and tool execution boundaries, timestamped stream events, commit ordering, hooks, and middleware composition.

Caller code owns prompts, conversation memory, provider selection, tool policy, persistence, retries, sandboxing, approvals, telemetry, and UI delivery.

## Kernel Map

- [Overview](./kernel/index.md): ownership boundary, scenarios, and API shape.
- [Quickstart](./kernel/quickstart.md): minimal end-to-end run.
- [Run state](./kernel/state-run.md): durable status, phases, turns, revisions, and resume behavior.
- [Session state](./kernel/state-session.md): caller-owned continuity across runs.
- [Hooks](./kernel/hooks.md): phase contracts for prompt assembly, routing, control, and observation.
- [Middleware](./kernel/middleware.md): wrappers around model and tool I/O.
- [Models](./kernel/models.md): `onTurnPrepared` model selection and `<provider>/<model-name>` resolution.
- [Tools](./kernel/tools.md): tool-call checkpoints and caller-owned execution policy.
- [API](./kernel/api.md): `runAgent` options, stream events, and exported types.
- [Examples](./kernel/examples.md): integration patterns.
