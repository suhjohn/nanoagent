import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel'
type Awaitable<A> = A | Promise<A>
type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>
type LoadedSkills = {
  skills: OpenCodeSkill[]
  diagnostics: OpenCodeSkillDiagnostic[]
}
type AllowFn<CONTEXT extends JsonLike> = (args: {
  name: string
  skill: OpenCodeSkill
  context: CONTEXT
}) => Awaitable<OpenCodeSkillDecision>
export type OpenCodeSkill = {
  name: string
  description: string
  content: string
  filePath: string
}
export type OpenCodeSkillDiagnostic = {
  type: 'warning'
  message: string
  path: string
}
export type OpenCodeSkillDecision =
  | {
      allow: true
    }
  | {
      allow: false
    }
export type OpenCodeSkillsParams<CONTEXT extends JsonLike> = {
  cwd?: string
  dirs?: readonly string[]
  urls?: readonly string[]
  includeGlobal?: boolean
  includeProjectAncestors?: boolean
  includeCatalog?: boolean
  fileSampleLimit?: number
  toolName?: string
  allow?: AllowFn<CONTEXT>
}
export type OpenCodeSkillToolOutput = {
  name: string
  description: string
  location: string
  directory: string
  content: string
  note: string
  files: string[]
}
export declare function withOpenCodeSkills<CONTEXT extends JsonLike>(
  params?: OpenCodeSkillsParams<CONTEXT>
): AgentPlugin<CONTEXT>
export declare function loadOpenCodeSkills(params: {
  cwd?: string
  dirs?: readonly string[]
  urls?: readonly string[]
  includeGlobal?: boolean
  includeProjectAncestors?: boolean
}): Promise<LoadedSkills>
export {}
