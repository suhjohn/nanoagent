# Fallback Model Retry

Retry a failed model call against a different model.

## The problem

Provider errors happen: rate limits, timeouts, brief outages. Retrying the same provider can repeat the same failure. Middleware can retry against a secondary provider after retryable errors.

## The pattern

Install a `callModel` middleware around every model call. On a retryable error, sleep with exponential backoff and rewrite `args.model` to the fallback. The fallback string resolves through `modelProviders` like any other model, so it can target a different provider, gateway, or credential set.

`retryWithFallbackModel` wraps `next`:

1. First attempt uses the model selected by `onTurnPrepared`.
2. Retries rewrite `args.model` to `openai/gpt-5.4-mini`.
3. Non-retryable errors and exhausted budgets rethrow immediately.

`isRetryableProviderError` matches `rate limit`, `timeout`, and `temporarily unavailable`. Keep the predicate strict: replaying a successful model call can double-bill or trigger duplicate tool calls.

## Source

See [src/index.ts](./src/index.ts).

## Run

```sh
bun run start "Explain model fallback retry in one sentence."
```

The CLI uses real providers from `packages/kernel/.env`.

## Check

```sh
bun run typecheck
```
