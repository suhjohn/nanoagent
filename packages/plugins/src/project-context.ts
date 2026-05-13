// Origin:
// - Codex: codex-rs/core/src/project_doc.rs, config instructions loading
// - Pi: packages/coding-agent/src/core/resource-loader.ts, system-prompt.ts
// Behavior: discover AGENTS/CLAUDE context files from project ancestors and prepend them to system context.
import { readFile } from 'node:fs/promises'
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

type ProjectContextParams = {
  cwd: string
  agentDir?: string
}

type SystemField = AgentTurnPreparedValue['system']

const CONTEXT_FILES = ['AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD']

export function withProjectContext<CONTEXT extends JsonLike>(
  params: ProjectContextParams
): AgentPlugin<CONTEXT> {
  const cwd = path.resolve(params.cwd)
  const agentDir = params.agentDir && path.resolve(params.agentDir)
  const loadContent = memoize(() => loadProjectContext({ cwd, agentDir }))

  return options => ({
    ...options,
    hooks: {
      ...options.hooks,
      onTurnPrepared: async args => {
        const previous = (await options.hooks.onTurnPrepared(
          args
        )) as AgentHookResult<AgentTurnPreparedValue, CONTEXT>
        if (!previous?.value || previous.control) return previous

        const content = await loadContent()
        if (!content) return previous

        return {
          context: previous.context,
          value: {
            ...previous.value,
            system: prependSystem(previous.value.system, content)
          }
        }
      }
    }
  })
}

function memoize<A>(fn: () => Promise<A>): () => Promise<A> {
  let promise: Promise<A> | undefined
  return () => (promise ??= fn())
}

async function loadProjectContext(params: {
  cwd: string
  agentDir?: string
}): Promise<string | undefined> {
  const dirs = [
    ...(params.agentDir ? [params.agentDir] : []),
    ...ancestorDirs(params.cwd)
  ]

  const seen = new Set<string>()
  const sections: string[] = []

  for (const dir of dirs) {
    for (const name of CONTEXT_FILES) {
      const file = path.join(dir, name)
      if (seen.has(file)) continue
      seen.add(file)

      const content = await readFileIfExists(file)
      if (content) {
        sections.push(
          `<project_context path="${file}">\n${content}\n</project_context>`
        )
      }
    }
  }

  return sections.length ? sections.join('\n\n') : undefined
}

function ancestorDirs(start: string): string[] {
  const dirs: string[] = []
  for (let current = start; ; current = path.dirname(current)) {
    dirs.push(current)
    if (path.dirname(current) === current) return dirs
  }
}

async function readFileIfExists(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

function isNodeError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && 'code' in error
}

function prependSystem(system: SystemField, content: string): SystemField {
  const message = { role: 'system' as const, content }
  if (system === undefined) return message
  if (typeof system === 'string') return `${content}\n\n${system}`
  return [message, ...(Array.isArray(system) ? system : [system])]
}
