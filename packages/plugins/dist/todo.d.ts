import type { JsonLike, RunAgentOptions } from '@nanoagent/kernel';
type AgentPlugin<CONTEXT extends JsonLike> = (options: RunAgentOptions<CONTEXT>) => RunAgentOptions<CONTEXT>;
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TodoPriority = 'high' | 'medium' | 'low';
export type Todo = {
    content: string;
    status: TodoStatus;
    priority: TodoPriority;
};
export type TodoUpdateParams<CONTEXT> = {
    todos: Todo[];
    context?: CONTEXT;
};
export type WithTodoWriteToolParams<CONTEXT extends JsonLike> = {
    update: (params: TodoUpdateParams<CONTEXT>) => unknown;
    toolName?: string;
};
export declare function withTodoWriteTool<CONTEXT extends JsonLike>(params: WithTodoWriteToolParams<CONTEXT>): AgentPlugin<CONTEXT>;
export {};
