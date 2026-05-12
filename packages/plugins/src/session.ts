import type {
  AgentPhaseEvent,
  AgentRunState,
  AgentSaveState,
  AgentTurnCompletedArgs,
  AgentVoidHookResult,
  JsonLike,
  RunAgentOptions,
  Turn
} from '@nanoagent/kernel'

type Awaitable<A> = A | Promise<A>

type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>

export type SessionStore<CONTEXT extends JsonLike> = {
  save: (args: {
    state: AgentRunState<CONTEXT>
    events: AgentPhaseEvent[]
  }) => Awaitable<void>
}

export type EventSink = (event: AgentPhaseEvent) => Awaitable<void>

export type TranscriptRecorder<CONTEXT extends JsonLike> = (args: {
  context: AgentTurnCompletedArgs<CONTEXT>['context']
  state: AgentTurnCompletedArgs<CONTEXT>['state']
  turnId: Turn['turnId']
}) => Awaitable<void>

export function withSessionStore<CONTEXT extends JsonLike>(
  store: SessionStore<CONTEXT>
): AgentPlugin<CONTEXT> {
  return withSaveState(args => store.save(args))
}

export function withEventSink<CONTEXT extends JsonLike>(
  sink: EventSink
): AgentPlugin<CONTEXT> {
  return withSaveState(async ({ events }) => {
    for (const event of events) await sink(event)
  })
}

export function withTranscriptRecorder<CONTEXT extends JsonLike>(
  record: TranscriptRecorder<CONTEXT>
): AgentPlugin<CONTEXT> {
  return withTurnCompleted(args =>
    record({
      context: args.context,
      state: args.state,
      turnId: args.turn.turnId
    })
  )
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
