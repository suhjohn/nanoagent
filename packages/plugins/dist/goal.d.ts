import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type Awaitable<A> = A | Promise<A>;
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
export type GoalStatus = 'active' | 'paused' | 'budget_limited' | 'complete';
export type Goal = {
    threadId?: string;
    goalId: string;
    objective: string;
    status: GoalStatus;
    tokenBudget?: number;
    tokensUsed: number;
    timeUsedSeconds: number;
    createdAt: string;
    updatedAt: string;
};
export type GoalToolResponse = {
    goal: Goal | null;
    remainingTokens: number | null;
    completionBudgetReport: string | null;
};
export type GoalStore<CONTEXT extends JsonLike> = {
    get: (context?: CONTEXT) => Awaitable<Goal | undefined>;
    create: (args: {
        context?: CONTEXT;
        objective: string;
        tokenBudget?: number;
    }) => Awaitable<Goal>;
    update: (args: {
        context?: CONTEXT;
        status: 'complete';
        expectedGoalId?: string;
    }) => Awaitable<Goal>;
    accountUsage?: (args: {
        context?: CONTEXT;
        goalId: string;
        tokens: number;
        seconds: number;
    }) => Awaitable<Goal | undefined>;
};
export type GoalToolsParams<CONTEXT extends JsonLike> = {
    store: GoalStore<CONTEXT>;
    prefix?: string;
    injectContext?: boolean;
};
export declare function withGoalTools<CONTEXT extends JsonLike>(params: GoalToolsParams<CONTEXT>): AgentPlugin<CONTEXT>;
export declare function createMemoryGoalStore<CONTEXT extends JsonLike>(params?: {
    threadId?: string;
    now?: () => string;
    id?: () => string;
}): GoalStore<CONTEXT>;
export {};
