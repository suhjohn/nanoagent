# Compact Transcript

Summarize older messages before they reach the model so long sessions stay under context limit.

## The problem

Long conversations outgrow the model's context window. Compaction replaces older messages with a summary while preserving recent messages verbatim. Caller code owns that memory policy.

## The pattern

Conversation memory is caller-owned: a summary string plus a list of recent `ModelMessage`s. `onTurnPrepared` decides per turn whether to compact, rewrites memory if needed, then returns the exact input for the next model call.

**Flow**:

- `appendUserMessage` writes user input to memory before the run starts.
- `onTurnPrepared` loads memory. If `messages.length > compactAfterMessages`, it summarizes everything older than the last `keepRecentMessages` into a new summary string and writes it back. The model receives the summary as a system message plus the recent window.
- `onTurnCompleted` appends the assistant's messages to memory after each turn.

`CompactPolicy` controls the thresholds. Defaults: compact after 16 messages, keep the last 6 verbatim. `compact` is injected as a dependency, so callers swap in their own summarizer (typically a smaller model).

## Source

See [src/index.ts](./src/index.ts).

## Check

```sh
bun run typecheck
```
