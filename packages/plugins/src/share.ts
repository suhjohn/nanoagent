// Origin:
// - OpenCode: packages/opencode/src/share/share-next.ts
// - Pi: packages/coding-agent/src/config.ts share viewer/session sync settings
// Behavior: debounce save-state events into caller-owned share sync client.
import type {
  AgentPhaseEvent,
  AgentRunState,
  AgentSaveState,
  JsonLike,
  RunAgentOptions
} from '@nanoagent/kernel'

type Awaitable<A> = A | Promise<A>

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

export type ShareSyncPayload<CONTEXT extends JsonLike> = {
  state: AgentRunState<CONTEXT>
  events: AgentPhaseEvent[]
  context: CONTEXT
}

export type ShareClient<CONTEXT extends JsonLike> = {
  sync: (payload: ShareSyncPayload<CONTEXT>) => Awaitable<void>
}

export type ShareSyncParams<CONTEXT extends JsonLike> = {
  client: ShareClient<CONTEXT>
  debounceMs?: number
}

export function withShareSync<CONTEXT extends JsonLike>(
  params: ShareSyncParams<CONTEXT>
): AgentPlugin<CONTEXT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let latest: ShareSyncPayload<CONTEXT> | undefined

  const flush = async () => {
    const pending = latest
    if (!pending) return
    latest = undefined
    await params.client.sync(pending)
  }

  return withSaveState<CONTEXT>(async ({ state, events }) => {
    latest = { state, events, context: state.context }
    if (!params.debounceMs) {
      await flush()
      return
    }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void flush(), params.debounceMs)
  })
}

function withSaveState<CONTEXT extends JsonLike>(
  effect: AgentSaveState<CONTEXT>
): AgentPlugin<CONTEXT> {
  return options => ({
    ...options,
    saveState: async args => {
      await options.saveState?.(args)
      await effect(args)
    }
  })
}
