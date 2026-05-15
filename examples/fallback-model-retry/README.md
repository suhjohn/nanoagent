# Fallback Model Retry

**When a provider fails, your agent doesn't.**

## What this showcases

Provider failure is a fact of life: rate limits, timeouts, brief outages. Retrying the same provider often repeats the same failure. This example wraps `streamText` with one middleware that recognizes retryable errors, backs off, and rewrites the model to a fallback. The kernel never sees the failure.

The retry happens at the call boundary. Hooks, state, and tool execution stay unchanged.

## The pattern

```ts
middleware: {
  callModel: [retryWithFallbackModel],
}
```

`retryWithFallbackModel` wraps `next`:

1. First attempt uses the model from `onTurnPrepared`.
2. On retryable error, sleep with exponential backoff and rewrite `args.model` to the fallback.
3. Non-retryable errors and exhausted budgets rethrow.

`isRetryableProviderError` matches `rate limit`, `timeout`, and `temporarily unavailable`.

## Try it

```sh
bun run start "Explain model fallback retry in one sentence."
```

## Source

See [src/index.ts](./src/index.ts).

## Check

```sh
bun run typecheck
```