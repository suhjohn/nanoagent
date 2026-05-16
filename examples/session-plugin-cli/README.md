# Session Plugin CLI

**The simplest end-to-end use of `withPlugins` and `sessionPlugin`.**

## What this showcases

`@nanoagent/plugin` exports `sessionPlugin` — a bundle of three hooks that hold conversation history inside caller-typed `context`:

- `onRunStarted` initializes an empty session context.
- `onTurnPrepared` projects `context.history.items` into the model's message array.
- `onTurnCompleted` appends the assistant response back into history.

This example wires that plugin into a CLI loop and persists `state.context` to disk every time the kernel commits, so subsequent runs continue the same session.

## The pattern

```ts
const session = sessionPlugin({ persister })
const options = withPlugins(baseOptions, [session])

for await (const event of runAgent(options)) { ... }
```

Per-commit persistence is the plugin's optional `persister` callback. The example's persister writes `state.context` as JSON to `SESSION_PATH`.

## Try it

```sh
bun run start
```

Resume a specific session:

```sh
SESSION_PATH=.session.json bun run start
```

Default runs use a fresh temp file under `$TMPDIR`.

## Source

See [src/index.ts](./src/index.ts).

## Check

```sh
bun run typecheck
```
