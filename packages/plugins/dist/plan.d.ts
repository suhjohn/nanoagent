import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'
type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>
export type PlanStatus = 'pending' | 'in_progress' | 'completed'
export type PlanItem = {
  step: string
  status: PlanStatus
}
export type PlanInput = {
  explanation?: string
  plan: PlanItem[]
}
export type PlanUpdateParams<CONTEXT> = {
  input: PlanInput
  context?: CONTEXT
}
export type WithPlanToolParams<CONTEXT extends JsonLike> = {
  update: (params: PlanUpdateParams<CONTEXT>) => unknown
  toolName?: string
}
export declare function withPlanTool<CONTEXT extends JsonLike>(
  params: WithPlanToolParams<CONTEXT>
): AgentPlugin<CONTEXT>
export {}
