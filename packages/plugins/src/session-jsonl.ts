// Origin:
// - Pi: packages/coding-agent/src/core/session-manager.ts JSONL session replay
// - OpenCode: packages/opencode/src/session/session.ts message stream/page projection
// Behavior: load persisted transcript before current turn input and append assistant turns after completion.
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentHookResult,
  AgentRunState,
  AgentTurnCompletedArgs,
  AgentTurnPreparedArgs,
  AgentTurnPreparedValue,
  AgentVoidHookResult,
  JsonLike,
  RunAgentOptions
} from '@nanoagent/kernel'

type Awaitable<A> = A | Promise<A>

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: unknown
}

export type JsonlMessageEntry = {
  id: string
  type: 'message'
  message: Message
}

export type JsonlCustomEntry = {
  id: string
  type: 'custom'
  message: Message
}

export type JsonlCompactionEntry = {
  id: string
  type: 'compaction'
  summary: string
}

export type JsonlBranchEntry = {
  id: string
  type: 'branch'
  summary: string
}

export type JsonlEntry =
  | JsonlMessageEntry
  | JsonlCustomEntry
  | JsonlCompactionEntry
  | JsonlBranchEntry

export type JsonlSessionRepo<CONTEXT extends JsonLike> = {
  entries: (sessionId: string) => Awaitable<readonly JsonlEntry[]>
  append: (sessionId: string, entries: readonly JsonlEntry[]) => Awaitable<void>
  saveRun?: (state: AgentRunState<CONTEXT>) => Awaitable<void>
}

export type JsonlSessionParams<CONTEXT extends JsonLike> = {
  sessionId: string
  repo: JsonlSessionRepo<CONTEXT>
}

export type FileJsonlSessionRepoParams = {
  dir: string
}

export function createFileJsonlSessionRepo<CONTEXT extends JsonLike>(
  params: FileJsonlSessionRepoParams
): JsonlSessionRepo<CONTEXT> {
  const dir = path.resolve(params.dir)
  return {
    entries: async sessionId => {
      const file = sessionFile(dir, sessionId, 'jsonl')
      const raw = await readFile(file, 'utf8').catch(error => {
        if (isNodeError(error) && error.code === 'ENOENT') return ''
        throw error
      })
      return raw
        .split('\n')
        .filter(line => line.trim())
        .map(line => parseJsonlEntry(JSON.parse(line)))
    },
    append: async (sessionId, entries) => {
      if (!entries.length) return
      await mkdir(dir, { recursive: true })
      const lines = entries.map(entry => JSON.stringify(entry)).join('\n')
      await appendFile(sessionFile(dir, sessionId, 'jsonl'), `${lines}\n`)
    },
    saveRun: async state => {
      await mkdir(dir, { recursive: true })
      await writeFile(
        sessionFile(dir, state.runId, 'state.json'),
        `${JSON.stringify(state, null, 2)}\n`
      )
    }
  }
}

export function withJsonlSession<CONTEXT extends JsonLike>(
  params: JsonlSessionParams<CONTEXT>
): AgentPlugin<CONTEXT> {
  const loadHistory = withTurnPrepared<CONTEXT>(async ({ value }) => {
    const entries = await params.repo.entries(params.sessionId)
    return { value: prependMessages(value, projectEntries(entries)) }
  })

  const recordAssistant = withTurnCompleted<CONTEXT>(async args => {
    const entry: JsonlCustomEntry = {
      id: args.turn.turnId,
      type: 'custom',
      message: assistantMessage(args.turn.modelResult?.text ?? '')
    }
    await params.repo.append(params.sessionId, [entry])
  })

  const saveRun = withSaveState<CONTEXT>(async ({ state }) => {
    await params.repo.saveRun?.(state)
  })

  return options => saveRun(recordAssistant(loadHistory(options)))
}

export function projectEntries(
  entries: readonly JsonlEntry[]
): readonly Message[] {
  return entries.flatMap(entryToMessages)
}

function entryToMessages(entry: JsonlEntry): readonly Message[] {
  switch (entry.type) {
    case 'message':
    case 'custom':
      return [entry.message]
    case 'compaction':
      return [systemMessage(`<compaction>\n${entry.summary}\n</compaction>`)]
    case 'branch':
      return [
        systemMessage(`<branch_summary>\n${entry.summary}\n</branch_summary>`)
      ]
  }
}

function assistantMessage(content: unknown): Message {
  return { role: 'assistant', content }
}

function systemMessage(content: unknown): Message {
  return { role: 'system', content }
}

function parseJsonlEntry(input: unknown): JsonlEntry {
  const record = assertRecord(input, 'jsonl entry')
  const id = stringField(record, 'id')
  const type = stringField(record, 'type')
  switch (type) {
    case 'message':
    case 'custom':
      return { id, type, message: parseMessage(record.message) }
    case 'compaction':
    case 'branch':
      return { id, type, summary: stringField(record, 'summary') }
    default:
      throw new Error(`Unsupported JSONL session entry type: ${type}.`)
  }
}

function parseMessage(input: unknown): Message {
  const record = assertRecord(input, 'message')
  const role = stringField(record, 'role')
  if (
    role !== 'system' &&
    role !== 'user' &&
    role !== 'assistant' &&
    role !== 'tool'
  ) {
    throw new Error('message role must be system, user, assistant, or tool.')
  }
  return { role, content: record.content }
}

function sessionFile(dir: string, sessionId: string, extension: string) {
  return path.join(dir, `${safeSessionId(sessionId)}.${extension}`)
}

function safeSessionId(sessionId: string) {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function prependMessages(
  value: AgentTurnPreparedValue,
  messages: readonly Message[]
): AgentTurnPreparedValue {
  return {
    ...value,
    messages: [...messages, ...(value.messages ?? [])]
  } as AgentTurnPreparedValue
}

function withTurnPrepared<CONTEXT extends JsonLike>(
  transform: (args: {
    args: AgentTurnPreparedArgs<CONTEXT>
    value: AgentTurnPreparedValue
  }) => Awaitable<AgentHookResult<AgentTurnPreparedValue, CONTEXT>>
): AgentPlugin<CONTEXT> {
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

        const next = await transform({
          args: args as AgentTurnPreparedArgs<CONTEXT>,
          value
        })
        return {
          context: next?.context ?? previous?.context,
          value: next?.value ?? value,
          control: next?.control
        }
      }
    }
  })
}

function assertRecord(input: unknown, name: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${name} must be an object.`)
  }
  return input as Record<string, unknown>
}

function stringField(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (typeof value === 'string') return value
  throw new Error(`${key} must be a string.`)
}

function isNodeError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && 'code' in error
}

function withTurnCompleted<CONTEXT extends JsonLike>(
  effect: (args: AgentTurnCompletedArgs<CONTEXT>) => Awaitable<void>
): AgentPlugin<CONTEXT> {
  return options => ({
    ...options,
    hooks: {
      ...options.hooks,
      onTurnCompleted: async args => {
        const previous = (await options.hooks.onTurnCompleted?.(
          args
        )) as AgentVoidHookResult<CONTEXT>
        if (previous?.control) return previous
        await effect(args)
        return previous
      }
    }
  })
}

function withSaveState<CONTEXT extends JsonLike>(
  effect: (args: { state: AgentRunState<CONTEXT> }) => Awaitable<void>
): AgentPlugin<CONTEXT> {
  return options => ({
    ...options,
    saveState: async args => {
      await options.saveState?.(args)
      await effect({ state: args.state as AgentRunState<CONTEXT> })
    }
  })
}
