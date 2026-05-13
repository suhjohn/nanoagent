import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'
type Awaitable<A> = A | Promise<A>
type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>
export type ShellRunInput<CONTEXT extends JsonLike> = {
  cmd: string
  args: string[]
  cwd?: string
  timeoutMs: number
  signal?: AbortSignal
  context?: CONTEXT
}
export type ShellRunResult = {
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
}
export type ShellPluginParams<CONTEXT extends JsonLike> = {
  cwd?: string
  timeoutMs?: number
  toolName?: string
  run?: (args: ShellRunInput<CONTEXT>) => Awaitable<ShellRunResult>
}
export declare function withShellTool<CONTEXT extends JsonLike>(
  params?: ShellPluginParams<CONTEXT>
): AgentPlugin<CONTEXT>
export {}
