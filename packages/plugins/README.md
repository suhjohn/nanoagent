# `@nanoagent/plugins`

Flat plugins for `@nanoagent/kernel`.

Plugin owns concrete behavior: tool schema, tool description, parsing, execution, middleware, or hook transformation. Runtime host only supplies boundary capabilities that library cannot own, like UI prompt rendering, durable store, or external auth.

```ts
import {
  composePlugins,
  withFilesystemTools,
  withQuestionTool
} from '@nanoagent/plugins'

const withProductPlugins = composePlugins(
  withFilesystemTools({ root: process.cwd() }),
  withQuestionTool({ ask: ui.ask })
)

const options = withProductPlugins({
  state: { context: {} },
  maxTurns: 10,
  hooks: {
    onTurnPrepared: () => ({
      value: {
        model: 'openai/gpt-5.4',
        messages: [{ role: 'user', content: 'Inspect repo.' }]
      }
    })
  }
})
```

## Shape

Each plugin is one file with actual logic.

- `question.ts`: user-question tool with schema, validation, and host UI callback.
- `plan.ts`: plan update tool with status validation and one-active-step rule.
- `filesystem.ts`: read, write, list, and grep tools rooted to workspace.
- `shell.ts`: command execution tool with timeout and abort handling.
- `prompt.ts`: prompt, memory, skill, command, and caller-owned prompt transforms.
- `compaction.ts`: OpenCode-style anchored summary compaction and Codex-style replacement-history compaction.
- `opencode-skills.ts`: OpenCode-style skill discovery, catalog injection, and explicit `skill` tool.
- `codex-skills.ts`: Codex-style scoped skill loading, catalog rendering, mention injection, and dependency checks.
- `session.ts`: session save, event fanout, transcript recording.
- `model.ts`: model providers, retry, fallback, result mapping.
- `tools.ts`: tool permission, result mapping, error capture, serialized execution, visibility.
- `goal.ts`: Codex-shaped goal tools, goal-context injection, usage accounting hooks, and caller-owned store.
- `snapshots.ts`: capture, restore, and diff around tool calls.

Kernel remains run loop and boundary contract. Plugins compose caller-owned behavior onto kernel options.
