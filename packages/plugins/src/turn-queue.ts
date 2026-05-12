import type {
  AgentHookResult,
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

export type TurnQueueMode = 'one-at-a-time' | 'drain-all'

export type TurnQueueStore<CONTEXT extends JsonLike> = {
  steering: (context: CONTEXT) => Awaitable<readonly string[]>
  shiftSteering: (context: CONTEXT, count: number) => Awaitable<void>
  followUp: (context: CONTEXT) => Awaitable<readonly string[]>
  shiftFollowUp: (context: CONTEXT, count: number) => Awaitable<void>
}

export type TurnQueueParams<CONTEXT extends JsonLike> = {
  store: TurnQueueStore<CONTEXT>
  mode?: TurnQueueMode
}

export function withTurnQueue<CONTEXT extends JsonLike>(
  params: TurnQueueParams<CONTEXT>
): AgentPlugin<CONTEXT> {
  const take = params.mode === 'one-at-a-time' ? 1 : Number.POSITIVE_INFINITY

  const drainSteering = withTurnPrepared<CONTEXT>(async ({ args, value }) => {
    const context = args.context as CONTEXT
    const steering = (await params.store.steering(context)).slice(0, take)
    if (!steering.length) return { value }
    await params.store.shiftSteering(context, steering.length)
    const messages = steering.map(text => userMessage(text))
    return { value: appendMessages(value, messages) }
  })

  const drainFollowUp = withTurnCompleted<CONTEXT>(async args => {
    const context = args.context as CONTEXT
    const followUp = (await params.store.followUp(context)).slice(0, take)
    if (followUp.length) {
      await params.store.shiftFollowUp(context, followUp.length)
    }
  })

  return options => drainFollowUp(drainSteering(options))
}

function userMessage(content: string): Message {
  return { role: 'user', content }
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
