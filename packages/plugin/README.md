# @nanoagent/plugin

Small option-composition helpers for `@nanoagent/kernel`.

`@nanoagent/kernel` executes agent run. `@nanoagent/plugin` builds final `RunAgentOptions` from reusable pieces.

```sh
npm install @nanoagent/kernel @nanoagent/plugin
```

## Plugins

Plugin is option transform.

```ts
import { runAgent } from '@nanoagent/kernel'
import { withPlugins, withTools, withHooks } from '@nanoagent/plugin'

const options = await withPlugins(baseOptions, [
  withTools(filesystemTools),
  withHooks({
    onTurnCompleted: async ({ turn }) => {
      console.log('turn completed', turn.turn)
    }
  })
])

for await (const event of runAgent(options)) {
  console.log(event.type)
}
```

No runtime, server, session manager, dependency container, package loader, or plugin registry is included. Apps own those.

## API

- `AgentPlugin`: transforms `RunAgentOptions`.
- `withPlugins`: applies plugins in order.
- `withTools`: merges tools.
- `withModelProviders`: merges model providers.
- `withMiddleware`: appends middleware arrays.
- `withHooks`: chains hooks.
- `withSaveState`: sets `saveState`.

Plugin order is behavior. Earlier middleware wraps later middleware because kernel executes middleware arrays left to right.
