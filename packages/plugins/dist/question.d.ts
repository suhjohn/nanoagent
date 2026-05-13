import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'
type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>
export type QuestionOption = {
  label: string
  description: string
}
export type Question = {
  id: string
  header: string
  question: string
  options: QuestionOption[]
}
export type QuestionAskParams<CONTEXT> = {
  input: {
    questions: Question[]
  }
  context?: CONTEXT
  signal?: AbortSignal
  toolCallId: string
}
export type WithQuestionToolParams<CONTEXT extends JsonLike> = {
  ask: (params: QuestionAskParams<CONTEXT>) => unknown
  toolName?: string
}
export declare function withQuestionTool<CONTEXT extends JsonLike>(
  params: WithQuestionToolParams<CONTEXT>
): AgentPlugin<CONTEXT>
export {}
