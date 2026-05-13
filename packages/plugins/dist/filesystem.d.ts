import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'
type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>
export type FilesystemPluginOptions = {
  root: string
  readToolName?: string | false
  writeToolName?: string | false
  editToolName?: string | false
  listToolName?: string | false
  grepToolName?: string | false
}
export declare function withFilesystemTools<CONTEXT extends JsonLike>(
  options: FilesystemPluginOptions
): AgentPlugin<CONTEXT>
export {}
