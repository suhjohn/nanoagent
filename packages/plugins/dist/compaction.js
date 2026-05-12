const OPENCODE_MIN_PRESERVE_RECENT_TOKENS = 2_000;
const OPENCODE_MAX_PRESERVE_RECENT_TOKENS = 8_000;
const OPENCODE_DEFAULT_TAIL_TURNS = 2;
const OPENCODE_TOOL_OUTPUT_MAX_CHARS = 2_000;
const CODEX_COMPACT_USER_MESSAGE_MAX_TOKENS = 20_000;
const CODEX_SUMMARY_PREFIX = 'This conversation was compacted. Summary of previous context:';
export function estimateMessageTokens(messages) {
    return Math.ceil(JSON.stringify(messages).length / 4);
}
export function withOpenCodeCompaction(params) {
    return withTurnPrepared(async ({ args, value }) => {
        const messages = preparedMessages(value);
        const usableTokens = params.maxTokens - (params.reservedTokens ?? 0);
        if (estimateMessageTokens(messages) < usableTokens)
            return { value };
        const context = args.context;
        const trigger = params.trigger ?? 'auto';
        const previous = await params.store.latest(context);
        const selected = selectOpenCodeCompactionMessages({
            messages,
            preserveRecentTokens: params.preserveRecentTokens ??
                Math.min(OPENCODE_MAX_PRESERVE_RECENT_TOKENS, Math.max(OPENCODE_MIN_PRESERVE_RECENT_TOKENS, Math.floor(usableTokens * 0.25))),
            tailTurns: params.tailTurns ?? OPENCODE_DEFAULT_TAIL_TURNS
        });
        const compactedHead = compactToolOutputs(selected.head, OPENCODE_TOOL_OUTPUT_MAX_CHARS);
        const summary = (await params.summarize({
            context,
            messages: compactedHead,
            previousSummary: previous?.summary,
            prompt: openCodeCompactionPrompt({
                previousSummary: previous?.summary,
                context: params.context ? await params.context({ context }) : []
            }),
            trigger
        })).trim();
        const nextMessages = [
            message('system', `<context_summary>\n${summary}\n</context_summary>`),
            ...selected.tail
        ];
        await params.store.save(context, {
            summary,
            tokensBefore: estimateMessageTokens(messages),
            tokensAfter: estimateMessageTokens(nextMessages),
            trigger,
            createdAt: new Date().toISOString(),
            readFiles: extractToolPaths(selected.head, ['read_file', 'read']),
            modifiedFiles: extractToolPaths(selected.head, [
                'write_file',
                'edit_file',
                'apply_patch',
                'write',
                'edit'
            ])
        });
        return {
            value: { ...value, messages: nextMessages }
        };
    });
}
export function withCodexCompaction(params) {
    return withTurnPrepared(async ({ args, value }) => {
        const messages = preparedMessages(value);
        if (estimateMessageTokens(messages) < params.maxTokens)
            return { value };
        const context = args.context;
        const trigger = params.trigger ?? 'auto';
        const hookArgs = {
            context,
            trigger,
            model: value.model,
            turnId: args.turn.turnId,
            messages
        };
        const pre = await params.preCompact?.(hookArgs);
        if (pre?.continue === false) {
            return {
                value,
                control: { type: 'pause', reason: pre.stopReason ?? 'pre_compact' }
            };
        }
        const previous = await params.store?.latest(context);
        const summary = (await params.summarize({
            context,
            messages,
            previousSummary: previous?.summary,
            prompt: params.compactPrompt ?? CODEX_COMPACTION_PROMPT,
            trigger
        })).trim();
        const initial = params.initialContext
            ? [...(await params.initialContext({ context }))]
            : [];
        const nextMessages = [
            ...initial,
            ...recentUserMessages({
                messages,
                maxTokens: params.preserveUserTokens ?? CODEX_COMPACT_USER_MESSAGE_MAX_TOKENS
            }).map(text => message('user', text)),
            message('user', codexSummaryText(summary))
        ];
        await params.store?.save(context, {
            summary,
            tokensBefore: estimateMessageTokens(messages),
            tokensAfter: estimateMessageTokens(nextMessages),
            trigger,
            createdAt: new Date().toISOString(),
            readFiles: extractToolPaths(messages, ['read_file', 'read']),
            modifiedFiles: extractToolPaths(messages, [
                'write_file',
                'edit_file',
                'apply_patch',
                'write',
                'edit'
            ])
        });
        const post = await params.postCompact?.({
            ...hookArgs,
            messages: nextMessages
        });
        if (post?.continue === false) {
            return {
                value: { ...value, messages: nextMessages },
                control: { type: 'pause', reason: post.stopReason ?? 'post_compact' }
            };
        }
        return {
            value: { ...value, messages: nextMessages }
        };
    });
}
export const withContextCompaction = withOpenCodeCompaction;
export function openCodeCompactionPrompt(input) {
    const anchor = input.previousSummary
        ? [
            'Update the anchored summary below using the conversation history above.',
            'Preserve still-true details, remove stale details, and merge in the new facts.',
            '<previous-summary>',
            input.previousSummary,
            '</previous-summary>'
        ].join('\n')
        : 'Create a new anchored summary from the conversation history above.';
    return [anchor, OPENCODE_SUMMARY_TEMPLATE, ...(input.context ?? [])].join('\n\n');
}
export function selectOpenCodeCompactionMessages(params) {
    if (params.tailTurns <= 0)
        return { head: params.messages, tail: [] };
    const turns = messageTurns(params.messages);
    if (!turns.length)
        return preserveRecentMessages(params);
    const recent = turns.slice(-params.tailTurns);
    let total = 0;
    let start = params.messages.length;
    for (let index = recent.length - 1; index >= 0; index--) {
        const turn = recent[index];
        const chunk = params.messages.slice(turn.start, turn.end);
        const tokens = estimateMessageTokens(chunk);
        if (total + tokens <= params.preserveRecentTokens) {
            total += tokens;
            start = turn.start;
            continue;
        }
        const remaining = params.preserveRecentTokens - total;
        const split = selectSuffixWithinBudget(chunk, remaining);
        if (split.length)
            start = turn.end - split.length;
        break;
    }
    if (start <= 0 || start >= params.messages.length) {
        return preserveRecentMessages(params);
    }
    return {
        head: params.messages.slice(0, start),
        tail: params.messages.slice(start)
    };
}
export function codexSummaryText(summary) {
    return summary.startsWith(`${CODEX_SUMMARY_PREFIX}\n`)
        ? summary
        : `${CODEX_SUMMARY_PREFIX}\n${summary}`;
}
function preserveRecentMessages(params) {
    const tail = selectSuffixWithinBudget(params.messages, params.preserveRecentTokens);
    return {
        head: params.messages.slice(0, params.messages.length - tail.length),
        tail
    };
}
function selectSuffixWithinBudget(messages, maxTokens) {
    if (maxTokens <= 0)
        return [];
    const selected = [];
    for (let index = messages.length - 1; index >= 0; index--) {
        selected.unshift(messages[index]);
        if (estimateMessageTokens(selected) > maxTokens) {
            selected.shift();
            break;
        }
    }
    return selected;
}
function messageTurns(messages) {
    const starts = [];
    for (let index = 0; index < messages.length; index++) {
        if (messages[index]?.role === 'user')
            starts.push(index);
    }
    return starts.map((start, index) => ({
        start,
        end: starts[index + 1] ?? messages.length
    }));
}
function recentUserMessages(params) {
    const selected = [];
    let remaining = params.maxTokens;
    for (let index = params.messages.length - 1; index >= 0; index--) {
        const text = userMessageText(params.messages[index]);
        if (!text || text.startsWith(`${CODEX_SUMMARY_PREFIX}\n`))
            continue;
        const tokens = estimateTextTokens(text);
        if (tokens <= remaining) {
            selected.unshift(text);
            remaining -= tokens;
            continue;
        }
        if (remaining > 0)
            selected.unshift(truncateTextTokens(text, remaining));
        break;
    }
    return selected;
}
function compactToolOutputs(messages, maxChars) {
    return messages.map(item => rewriteMessageContent(item, maxChars));
}
function rewriteMessageContent(message, maxChars) {
    if (typeof message.content === 'string') {
        return {
            ...message,
            content: truncateToolOutput(message.content, maxChars)
        };
    }
    return {
        ...message,
        content: rewriteUnknown(message.content, maxChars)
    };
}
function rewriteUnknown(value, maxChars) {
    if (typeof value === 'string')
        return truncateToolOutput(value, maxChars);
    if (Array.isArray(value))
        return value.map(item => rewriteUnknown(item, maxChars));
    if (!value || typeof value !== 'object')
        return value;
    const output = {};
    for (const [key, child] of Object.entries(value)) {
        output[key] =
            key === 'output' || key === 'result' || key === 'error'
                ? rewriteUnknown(child, maxChars)
                : child;
    }
    return output;
}
function truncateToolOutput(text, maxChars) {
    if (text.length <= maxChars)
        return text;
    return `${text.slice(0, maxChars)}\n[Tool output truncated for compaction: omitted ${text.length - maxChars} chars]`;
}
function extractToolPaths(messages, toolNames) {
    const names = new Set(toolNames);
    const paths = new Set();
    for (const item of messages)
        collectPaths(item, names, paths, false);
    return [...paths].sort((a, b) => a.localeCompare(b));
}
function collectPaths(value, toolNames, paths, insideTool) {
    if (typeof value === 'string') {
        const parsed = parseJson(value);
        if (parsed !== undefined)
            collectPaths(parsed, toolNames, paths, insideTool);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value)
            collectPaths(item, toolNames, paths, insideTool);
        return;
    }
    if (!value || typeof value !== 'object')
        return;
    const record = value;
    const toolName = stringValue(record.toolName) ??
        stringValue(record.tool) ??
        stringValue(record.tool_name) ??
        stringValue(record.name);
    const nextInsideTool = insideTool || !!(toolName && toolNames.has(toolName));
    if (nextInsideTool) {
        const directPath = stringValue(record.path) ?? stringValue(record.filePath);
        if (directPath)
            paths.add(directPath);
    }
    for (const child of Object.values(record)) {
        collectPaths(child, toolNames, paths, nextInsideTool);
    }
}
function userMessageText(message) {
    if (message?.role !== 'user')
        return undefined;
    return contentText(message.content);
}
function contentText(content) {
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return undefined;
    const text = content
        .map(item => typeof item === 'string'
        ? item
        : item && typeof item === 'object'
            ? stringValue(item.text)
            : undefined)
        .filter((item) => item !== undefined)
        .join('\n');
    return text || undefined;
}
function preparedMessages(value) {
    return (value.messages ?? []).filter(Boolean);
}
function withTurnPrepared(transform) {
    return options => ({
        ...options,
        hooks: {
            ...options.hooks,
            onTurnPrepared: async (args) => {
                const previous = (await options.hooks.onTurnPrepared(args));
                if (previous?.control)
                    return previous;
                const value = previous?.value;
                if (!value)
                    return previous;
                const next = await transform({ args, value });
                return {
                    context: next?.context ?? previous?.context,
                    value: next?.value ?? value,
                    control: next?.control
                };
            }
        }
    });
}
function message(role, content) {
    return { role, content };
}
function estimateTextTokens(text) {
    return Math.ceil(text.length / 4);
}
function truncateTextTokens(text, maxTokens) {
    return text.slice(0, maxTokens * 4);
}
function stringValue(value) {
    return typeof value === 'string' ? value : undefined;
}
function parseJson(value) {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('['))
        return undefined;
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return undefined;
    }
}
const OPENCODE_SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Goal
- [single-sentence task summary]

## Constraints & Preferences
- [user constraints, preferences, specs, or "(none)"]

## Progress
### Done
- [completed work or "(none)"]

### In Progress
- [current work or "(none)"]

### Blocked
- [blockers or "(none)"]

## Key Decisions
- [decision and why, or "(none)"]

## Next Steps
- [ordered next actions or "(none)"]

## Critical Context
- [important technical facts, errors, open questions, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers when known.
- Do not mention the summary process or that context was compacted.`;
const CODEX_COMPACTION_PROMPT = `Summarize conversation history into compact working memory for future turns.
Preserve user goals, constraints, decisions, current state, relevant files, tool results, unresolved questions, and next steps.
Preserve exact file paths, commands, error strings, and identifiers.
Drop superseded details, repetition, and routine tool chatter.
Return concise Markdown.`;
