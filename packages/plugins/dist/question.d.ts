import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
type Awaitable<A> = A | Promise<A>;
export type QuestionOption = {
    label: string;
    description: string;
};
export type Question = {
    id: string;
    header: string;
    question: string;
    isOther: boolean;
    isSecret: boolean;
    options: QuestionOption[];
};
export type QuestionAnswer = {
    answers: string[];
};
export type QuestionResponse = {
    answers: Record<string, QuestionAnswer>;
};
export type QuestionAskParams<CONTEXT> = {
    input: {
        questions: Question[];
    };
    context?: CONTEXT;
    signal?: AbortSignal;
    toolCallId: string;
    turnId: string;
};
export type WithQuestionToolParams<CONTEXT extends JsonLike> = {
    ask: (params: QuestionAskParams<CONTEXT>) => Awaitable<QuestionResponse | undefined>;
    availableModes?: readonly string[];
    mode?: (params: {
        context?: CONTEXT;
    }) => string | undefined;
    isRootThread?: (params: {
        context?: CONTEXT;
    }) => boolean;
    toolName?: string;
};
export declare function withQuestionTool<CONTEXT extends JsonLike>(params: WithQuestionToolParams<CONTEXT>): AgentPlugin<CONTEXT>;
export {};
