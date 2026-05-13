import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'
type Awaitable<A> = A | Promise<A>
type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>
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
export declare function withTurnQueue<CONTEXT extends JsonLike>(
  params: TurnQueueParams<CONTEXT>
): AgentPlugin<CONTEXT>
export {}
