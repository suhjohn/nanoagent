import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
export type Skill = {
    name: string;
    description: string;
    content: string;
    filePath: string;
    disableModelInvocation: boolean;
};
export type SkillDiagnostic = {
    type: 'warning';
    message: string;
    path: string;
};
type LoadSkillsResult = {
    skills: Skill[];
    diagnostics: SkillDiagnostic[];
};
export declare function loadSkills(dirs: readonly string[]): Promise<LoadSkillsResult>;
export declare function withDiscoveredSkills<CONTEXT extends JsonLike>(params: {
    dirs: readonly string[];
}): AgentPlugin<CONTEXT>;
export declare function formatSkillInvocation(skill: Skill, additionalInstructions?: string): string;
export {};
