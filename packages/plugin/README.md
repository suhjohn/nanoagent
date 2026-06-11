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
import { skillsPlugin, withPlugins } from '@nanoagent/plugin'

const options = withPlugins(baseOptions, [
  {
    hooks: {
      onTurnCompleted: async ({ turn }) => {
        console.log('turn completed', turn.turn)
      }
    }
  },
  skillsPlugin()
])

for await (const event of runAgent(options)) {
  console.log(event.type)
}
```

No runtime, server, session manager, dependency container, package loader, or plugin registry is included. Apps own those.

## API

- `AgentPlugin`: transforms `RunAgentOptions`.
- `withPlugins`: applies plugins in order.
- `sessionPlugin`: projects session history into messages and records model output.
- `skillsPlugin`: loads local `SKILL.md` files and injects selected skills during `onTurnPrepared`.
- `skillRoots`: returns Codex-style default roots.
- `loadSkills`: scans skill roots and returns catalog metadata.

Plugin order is behavior. Earlier middleware wraps later middleware because kernel executes middleware arrays left to right. Put `skillsPlugin` after plugin that assembles `messages`.

## Skills

Skill root contains directories with `SKILL.md`.

```text
.agents/skills/
  publish-nanoagent/
    SKILL.md
    agents/openai.yaml
```

`SKILL.md` uses scalar YAML frontmatter.

```md
---
name: publish-nanoagent
description: Publish Nanoagent npm packages.
---

Run package checks, npm dry-run, then publish when auth is present.
```

`agents/openai.yaml` supports Codex-compatible implicit policy.

```yaml
allow_implicit_invocation: false
```

`skillsPlugin` always injects catalog for implicit skills. Explicit `$name` mentions inject full matching `SKILL.md` body before last user message. Duplicate names stay unselected unless caller supplies `select`.

Default roots scan `.agents/skills`, `.claude/skills`, and `.codex/skills` from `cwd` ancestors, `$CODEX_HOME/skills`, `$HOME/.agents/skills`, and `$HOME/.claude/skills`. Missing roots are skipped.

```ts
const options = withPlugins(baseOptions, [
  buildMessagesPlugin,
  skillsPlugin({
    select: ({ skills }) =>
      skills.filter(skill => skill.name === 'publish-nanoagent')
  })
])
```
