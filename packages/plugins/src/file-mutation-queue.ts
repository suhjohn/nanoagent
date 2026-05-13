// Origin:
// - OpenCode: packages/opencode/src/tool/edit.ts file locks
// - Codex: codex-rs/core/src/tools/orchestrator.rs serialized tool execution
// Behavior: serialize mutating file tools by realpath/root key.
import { realpathSync } from 'node:fs'
import path from 'node:path'
import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type PathExtractor = (input: unknown) => string | undefined

const DEFAULT_TOOL_NAMES: readonly string[] = [
  'write_file',
  'edit_file',
  'apply_patch',
  'write',
  'edit'
]

const queues = new Map<string, Promise<void>>()

export function withFileMutationQueue<CONTEXT extends JsonLike>(params?: {
  toolNames?: readonly string[]
  path?: PathExtractor
}): AgentPlugin<CONTEXT> {
  const names = new Set(params?.toolNames ?? DEFAULT_TOOL_NAMES)
  const customPath = params?.path

  return options => ({
    ...options,
    middleware: {
      ...options.middleware,
      callTool: [
        ...(options.middleware?.callTool ?? []),
        async ({ input, next }) => {
          if (!names.has(input.toolCall.toolName)) return next(input)
          const target =
            customPath?.(input.toolCall.input) ??
            defaultPath(input.toolCall.input)
          if (!target) return next(input)
          return runSerialized(queueKey(target), () => next(input))
        }
      ]
    }
  })
}

async function runSerialized<A>(
  key: string,
  task: () => Promise<A>
): Promise<A> {
  const previous = queues.get(key) ?? Promise.resolve()
  let release = () => {}
  const current = previous.then(
    () => new Promise<void>(resolve => (release = resolve))
  )
  queues.set(key, current)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (queues.get(key) === current) queues.delete(key)
  }
}

function defaultPath(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const record = input as Record<string, unknown>
  if (typeof record.path === 'string') return record.path
  if (typeof record.filePath === 'string') return record.filePath
  return undefined
}

function queueKey(filePath: string): string {
  const resolved = path.resolve(filePath)
  try {
    return realpathSync.native(resolved)
  } catch {
    return resolved
  }
}
