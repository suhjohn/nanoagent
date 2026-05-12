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

export function withJsonlSession<CONTEXT extends JsonLike>(
  params: JsonlSessionParams<CONTEXT>
): AgentPlugin<CONTEXT> {
  const loadHistory = withTurnPrepared<CONTEXT>(async ({ value }) => {
    const entries = await params.repo.entries(params.sessionId)
    return { value: appendMessages(value, projectEntries(entries)) }
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
      return [
        systemMessage(`<compaction>\n${entry.summary}\n</compaction>`)
      ]
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

function appendMessages(
  value: AgentTurnPreparedValue,
  messages: readonly Message[]
): AgentTurnPreparedValue {
  return {
    ...value,
    messages: [...(value.messages ?? []), ...messages]
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
  effect: (args: {
    state: AgentRunState<CONTEXT>
  }) => Awaitable<void>
): AgentPlugin<CONTEXT> {
  return options => ({
    ...options,
    saveState: async args => {
      await options.saveState?.(args)
      await effect({ state: args.state as AgentRunState<CONTEXT> })
    }
  })
}
