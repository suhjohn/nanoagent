# Skip Protected Tool

**The model asked to delete a protected file. The policy said no. The model got told why.**

## What this showcases

Argument-aware tool policy. One hook inspects the exact `toolName`, `toolCallId`, and `input` for every tool call. When policy rejects, the hook returns a synthetic result the model can read. The tool executor never runs.

This is the difference between "block the tool" and "block this call with these arguments." Same tool, same model, different decision per invocation.

## The pattern

```ts
onToolCallStarted: ({ toolCallId, toolName, input }) => {
  if (toolName === "deleteFile" && isProtectedPath(input)) {
    return {
      value: {
        type: "skip",
        result: {
          toolCallId,
          toolName,
          input,
          output: { blocked: true, reason: "protected_path" },
        },
      },
    };
  }
};
```

Kernel records the synthetic result as a completed tool response. The model receives an explicit answer instead of a silent denial, so it does not retry the same call in a loop.

## Try it

```sh
bun run start
```

Press enter for `/private/secret.txt`, or type any path. The hook returns `{ blocked: true, reason: "protected_path" }` for protected paths. The executor throws if it ever runs for blocked input.

## Source

See [src/index.ts](./src/index.ts).

## Check

```sh
bun run typecheck
```