// Origin:
// - Pi: packages/coding-agent/src/core/prompt-template.ts, slash-commands.ts
// Behavior: load markdown prompt templates and expand slash-command arguments into user prompts.
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentHookResult,
  AgentTurnPreparedValue,
  JsonLike,
  RunAgentOptions
} from '@nanoagent/kernel'

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

export type PromptTemplate = {
  name: string
  description?: string
  content: string
  filePath: string
}

export type PromptCommand = {
  name: string
  args: string[]
}

export type PromptTemplatesParams<CONTEXT extends JsonLike> = {
  dirs: readonly string[]
  getInput: (context: CONTEXT) => string | undefined
}

export async function loadPromptTemplates(
  dirs: readonly string[]
): Promise<PromptTemplate[]> {
  const templates: PromptTemplate[] = []
  for (const dir of dirs) {
    const info = await stat(dir).catch(() => undefined)
    if (!info?.isDirectory()) continue
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const filePath = path.join(dir, entry.name)
      const raw = await readFile(filePath, 'utf8')
      const { frontmatter, body } = frontmatterBlock(raw)
      templates.push({
        name: path.basename(entry.name, '.md'),
        description:
          typeof frontmatter.description === 'string'
            ? frontmatter.description
            : undefined,
        content: body,
        filePath
      })
    }
  }
  return templates
}

export function expandPromptTemplate(
  template: string,
  args: readonly string[]
) {
  return template
    .replace(/\$\{@:([0-9]+):([0-9]+)\}/g, (_match, start, count) =>
      args.slice(Number(start) - 1, Number(start) - 1 + Number(count)).join(' ')
    )
    .replace(/\$\{@:([0-9]+)\}/g, (_match, start) =>
      args.slice(Number(start) - 1).join(' ')
    )
    .replace(/\$ARGUMENTS/g, args.join(' '))
    .replace(/\$@/g, args.join(' '))
    .replace(
      /\$([1-9][0-9]*)/g,
      (_match, index) => args[Number(index) - 1] ?? ''
    )
}

export function withPromptTemplates<CONTEXT extends JsonLike>(
  params: PromptTemplatesParams<CONTEXT>
): AgentPlugin<CONTEXT> {
  let cached: Promise<PromptTemplate[]> | undefined
  return options => ({
    ...options,
    hooks: {
      ...options.hooks,
      onTurnPrepared: async args => {
        const previous = (await options.hooks.onTurnPrepared(
          args
        )) as AgentHookResult<AgentTurnPreparedValue, CONTEXT>
        if (previous?.control) return previous
        const value = previous?.value
        if (!value) return previous

        const command = parseSlashCommand(
          params.getInput(args.context as CONTEXT)
        )
        if (!command) return previous

        cached ??= loadPromptTemplates(params.dirs)
        const template = (await cached).find(t => t.name === command.name)
        if (!template) return previous

        const expanded = expandPromptTemplate(template.content, command.args)
        return {
          context: previous?.context,
          value: appendMessage(value, { role: 'user', content: expanded })
        }
      }
    }
  })
}

function appendMessage(
  value: AgentTurnPreparedValue,
  message: { role: 'user'; content: string }
): AgentTurnPreparedValue {
  return {
    ...value,
    messages: [...(value.messages ?? []), message]
  } as AgentTurnPreparedValue
}

export function parseSlashCommand(
  input: string | undefined
): PromptCommand | undefined {
  if (typeof input !== 'string' || !input.startsWith('/')) return undefined
  const [name, ...args] = parseArgs(input.slice(1))
  if (!name) return undefined
  return { name, args }
}

function parseArgs(input: string): string[] {
  return [...input.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    match => match[1] ?? match[2] ?? match[3] ?? ''
  )
}

function frontmatterBlock(raw: string): {
  frontmatter: Record<string, string>
  body: string
} {
  if (!raw.startsWith('---\n')) return { frontmatter: {}, body: raw }
  const end = raw.indexOf('\n---\n', 4)
  if (end < 0) return { frontmatter: {}, body: raw }
  const frontmatter: Record<string, string> = {}
  for (const line of raw.slice(4, end).split('\n')) {
    const split = line.indexOf(':')
    if (split > 0)
      frontmatter[line.slice(0, split).trim()] = line.slice(split + 1).trim()
  }
  return { frontmatter, body: raw.slice(end + 5) }
}
