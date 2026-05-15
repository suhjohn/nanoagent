# Compact Transcript

**Long conversations that never run out of context.**

## What this showcases

Every long conversation eventually outgrows the model context window. Kernel does not own that problem, caller code does.

This example keeps one JSON session with two arrays:

- `history`: full append-only transcript.
- `context`: trimmed messages sent to model next turn.

## The pattern

Each run appends the user message to both arrays, then sends `context` to `runAgent`.

`onTurnCompleted` appends the assistant reply to full `history`, checks token usage, compacts older `context` messages when needed, and returns updated hook context.

If `totalUsage.totalTokens` crosses `COMPACT_AFTER_TOKENS`, older context messages are summarized with one concrete call to another model.

Full `history` keeps every original message. Only `context` becomes `[summary, ...recentMessages]`.

## Try it

```sh
bun run start
```

Force compaction every turn:

```sh
COMPACT_AFTER_TOKENS=1 bun run start "Remember that my favorite color is blue."
```

Default runs use a fresh temp session file. Set `SESSION_PATH` to resume a specific compact transcript:

```sh
SESSION_PATH=.compact-session.json bun run start
```

## Source

See [src/index.ts](./src/index.ts).

## Check

```sh
bun run typecheck
```