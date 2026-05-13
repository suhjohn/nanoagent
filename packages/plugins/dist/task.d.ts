import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'
type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>
type SubagentDescriptor = {
  name: string
} & Record<string, unknown>
type TaskRunResult = {
  taskId: string
  output: string
  metadata?: unknown
}
type TaskParams<CONTEXT extends JsonLike> = {
  toolName?: string
  agents: () => SubagentDescriptor[] | Promise<SubagentDescriptor[]>
  run: (args: {
    description: string
    prompt: string
    agent: SubagentDescriptor
    taskId?: string
    context: CONTEXT | undefined
  }) => Promise<TaskRunResult>
}
export declare function withTaskTool<CONTEXT extends JsonLike>(
  params: TaskParams<CONTEXT>
): AgentPlugin<CONTEXT>
export {}
