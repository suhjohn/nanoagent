import type {
  AgentTurnPreparedValue,
  JsonLike,
  RunAgentOptions
} from '@nanoagent/kernel'
type Awaitable<A> = A | Promise<A>
type AgentPlugin<CONTEXT extends JsonLike> = (
  options: RunAgentOptions<CONTEXT>
) => RunAgentOptions<CONTEXT>
type LoadResult = {
  skills: CodexSkill[]
  diagnostics: CodexSkillDiagnostic[]
}
export type CodexSkillScope = 'repo' | 'user' | 'system' | 'admin' | 'plugin'
export type CodexSkillRoot =
  | string
  | {
      path: string
      scope: CodexSkillScope
      pluginId?: string
    }
export type CodexSkill = {
  name: string
  description: string
  shortDescription?: string
  content: string
  filePath: string
  scope: CodexSkillScope
  pluginId?: string
  policy: {
    allowImplicitInvocation: boolean
    products: readonly string[]
  }
  dependencies: {
    env: readonly string[]
    tools: readonly string[]
  }
}
export type CodexSkillDiagnostic = {
  type: 'warning'
  message: string
  path: string
}
export type CodexSkillsParams<CONTEXT extends JsonLike> = {
  cwd?: string
  roots?: readonly CodexSkillRoot[]
  enabled?: boolean
  includeInstructions?: boolean
  product?: string
  disabledNames?: readonly string[]
  maxCatalogCharacters?: number
  resolveEnv?: (args: {
    name: string
    skill: CodexSkill
    context: CONTEXT
  }) => Awaitable<string | undefined>
  onMissingEnv?: (args: {
    names: readonly string[]
    skill: CodexSkill
    context: CONTEXT
  }) => Awaitable<void>
}
export declare function withCodexSkills<CONTEXT extends JsonLike>(
  params?: CodexSkillsParams<CONTEXT>
): AgentPlugin<CONTEXT>
export declare function loadCodexSkills(params: {
  cwd?: string
  roots?: readonly CodexSkillRoot[]
}): Promise<LoadResult>
export declare function renderCodexSkillInstructions(params: {
  skills: readonly CodexSkill[]
  maxCharacters?: number
}): string
export declare function collectSkillMentions(params: {
  value: AgentTurnPreparedValue
  skills: readonly CodexSkill[]
}): CodexSkill[]
export {}
