const TODO_STATUSES = [
    'pending',
    'in_progress',
    'completed',
    'cancelled'
];
const TODO_PRIORITIES = ['high', 'medium', 'low'];
export function withTodoWriteTool(params) {
    const toolName = params.toolName ?? 'todowrite';
    const tool = {
        description: 'Replace current session todo list with complete ordered task state. Status must be pending, in_progress, completed, or cancelled.',
        inputSchema: objectSchema({
            todos: {
                type: 'array',
                items: objectSchema({
                    content: { type: 'string' },
                    status: { type: 'string', enum: TODO_STATUSES },
                    priority: { type: 'string', enum: TODO_PRIORITIES }
                }, ['content', 'status', 'priority'])
            }
        }, ['todos']),
        execute: async (input, options) => {
            const todos = parseTodos(input);
            await params.update({ todos, context: options.experimental_context });
            const open = todos.filter(todo => todo.status !== 'completed').length;
            return { title: `${open} todos`, todos };
        }
    };
    return options => ({
        ...options,
        tools: { ...(options.tools ?? {}), [toolName]: tool }
    });
}
function parseTodos(input) {
    const record = assertRecord(input, 'todowrite');
    if (!Array.isArray(record.todos)) {
        throw new Error('todos must be an array.');
    }
    return record.todos.map(parseTodo);
}
function parseTodo(raw) {
    const item = assertRecord(raw, 'todo');
    const status = stringField(item, 'status');
    const priority = stringField(item, 'priority');
    if (!isTodoStatus(status)) {
        throw new Error(`Invalid todo status "${status}".`);
    }
    if (!isTodoPriority(priority)) {
        throw new Error(`Invalid todo priority "${priority}".`);
    }
    return { content: stringField(item, 'content'), status, priority };
}
function isTodoStatus(value) {
    return TODO_STATUSES.includes(value);
}
function isTodoPriority(value) {
    return TODO_PRIORITIES.includes(value);
}
function objectSchema(properties, required = []) {
    return { type: 'object', properties, required, additionalProperties: false };
}
function assertRecord(input, name) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error(`${name} input must be an object.`);
    }
    return input;
}
function stringField(input, key) {
    const value = input[key];
    if (typeof value === 'string')
        return value;
    throw new Error(`${key} must be a string.`);
}
