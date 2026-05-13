import type {
  AgentPhaseEvent,
  AgentRunState,
  AgentTurnCompletedArgs,
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
export declare function withSessionStore<CONTEXT extends JsonLike>(
  store: SessionStore<CONTEXT>
): AgentPlugin<CONTEXT>
export declare function withEventSink<CONTEXT extends JsonLike>(
  sink: EventSink
): AgentPlugin<CONTEXT>
export declare function withTranscriptRecorder<CONTEXT extends JsonLike>(
  record: TranscriptRecorder<CONTEXT>
): AgentPlugin<CONTEXT>
export {}
