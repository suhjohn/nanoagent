import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'
type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>
type ToolCallSite<CONTEXT extends JsonLike> = {
  toolName: string
  input: unknown
  context: CONTEXT
}
type Snapshotter<CONTEXT extends JsonLike, SNAPSHOT> = {
  capture: (site: ToolCallSite<CONTEXT>) => Promise<SNAPSHOT> | SNAPSHOT
  restore?: (
    args: ToolCallSite<CONTEXT> & {
      snapshot: SNAPSHOT
      error: unknown
    }
  ) => unknown | Promise<unknown>
  diff?: (
    args: ToolCallSite<CONTEXT> & {
      snapshot: SNAPSHOT
      output: unknown
    }
  ) => unknown | Promise<unknown>
}
export declare function withSnapshots<CONTEXT extends JsonLike, SNAPSHOT>(
  snapshotter: Snapshotter<CONTEXT, SNAPSHOT>
): AgentPlugin<CONTEXT>
export {}
