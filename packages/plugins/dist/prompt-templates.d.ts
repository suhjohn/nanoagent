import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'
type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>
export type PromptTemplate = {
  name: string
  description?: string
  content: string
  filePath: string
}
export type PromptCommand = {
  name: string
  args: string[]
}
export type PromptTemplatesParams<CONTEXT extends JsonLike> = {
  dirs: readonly string[]
  getInput: (context: CONTEXT) => string | undefined
}
export declare function loadPromptTemplates(
  dirs: readonly string[]
): Promise<PromptTemplate[]>
export declare function expandPromptTemplate(
  template: string,
  args: readonly string[]
): string
export declare function withPromptTemplates<CONTEXT extends JsonLike>(
  params: PromptTemplatesParams<CONTEXT>
): AgentPlugin<CONTEXT>
export declare function parseSlashCommand(
  input: string | undefined
): PromptCommand | undefined
export {}
