# Sparse Checkpoints

**Persist every event. Snapshot state only when it matters.**

## What this showcases

`saveState` is your function. Kernel calls it at every durable phase, but you decide what to write to disk. This example splits the durability boundary in two: an append-only event log captures every commit, and full state snapshots fire only at lifecycle boundaries where replay is unsafe.

The result: cheap, frequent writes for the log; rare, complete snapshots for resume.

## The pattern

```ts
const saveState: AgentSaveState<Context> = async ({ state, events }) => {
  await appendJsonl(eventsPath, events);

  if (!shouldCheckpoint({ state, events })) {
    return;
  }

  await writeJsonAtomic(checkpointPath, { state });
};
```

`shouldCheckpoint` snapshots on `turn_prepared`, `model_completed`, `tool_call_completed`, `turn_completed`, `run_completed`, `pause`, and `run_failed`. Everything else gets logged but not snapshotted.

## Try it

```sh
bun run start
```

Default runs use a fresh `SESSION_ID` under temp storage. Set `SESSION_ID` or `SESSION_DIR` to resume a specific checkpoint set.

## Source

See [src/index.ts](./src/index.ts).

## Check

```sh
bun run typecheck
```