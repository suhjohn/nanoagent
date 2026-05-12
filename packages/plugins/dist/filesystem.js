// Origin:
// - OpenCode: packages/opencode/src/tool/read.ts, write.ts, edit.ts, glob.ts, grep.ts, apply_patch.ts
// - Pi: packages/coding-agent/src/core/tools/read.ts, write.ts, edit.ts, grep.ts, find.ts, ls.ts
// Behavior: rooted file operations, exact edit replacements, bounded read/search output, and mutation-safe coding tools.
import { constants } from 'node:fs';
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
export function withFilesystemTools(options) {
    const root = path.resolve(options.root);
    const tools = {
        [options.readToolName ?? 'read_file']: {
            description: 'Read UTF-8 text file inside workspace root. Use for exact source inspection before edits.',
            inputSchema: objectSchema({
                path: { type: 'string' },
                maxBytes: {
                    type: 'integer',
                    minimum: 1,
                    description: 'Maximum bytes to read.'
                }
            }, ['path']),
            execute: async (input) => {
                const record = assertRecord(input, 'read_file');
                const filePath = insideRoot(root, stringField(record, 'path'));
                const maxBytes = numberField(record, 'maxBytes', 1_000_000);
                const file = await readFile(filePath);
                return {
                    path: path.relative(root, filePath),
                    content: file.subarray(0, maxBytes).toString('utf8')
                };
            }
        },
        [options.writeToolName ?? 'write_file']: {
            description: 'Write UTF-8 text file inside workspace root. Creates parent directories.',
            inputSchema: objectSchema({
                path: { type: 'string' },
                content: { type: 'string' }
            }, ['path', 'content']),
            execute: async (input) => {
                const record = assertRecord(input, 'write_file');
                const filePath = insideRoot(root, stringField(record, 'path'));
                const content = stringField(record, 'content');
                await mkdir(path.dirname(filePath), { recursive: true });
                await writeFile(filePath, content, 'utf8');
                return {
                    path: path.relative(root, filePath),
                    bytes: Buffer.byteLength(content)
                };
            }
        },
        [options.editToolName ?? 'edit_file']: {
            description: 'Apply one or more exact text replacements to a UTF-8 file. Each oldText must be unique in original content.',
            inputSchema: objectSchema({
                path: { type: 'string' },
                edits: {
                    type: 'array',
                    minItems: 1,
                    items: objectSchema({
                        oldText: { type: 'string' },
                        newText: { type: 'string' }
                    }, ['oldText', 'newText'])
                }
            }, ['path', 'edits']),
            execute: async (input) => {
                const record = assertRecord(input, 'edit_file');
                const filePath = insideRoot(root, stringField(record, 'path'));
                if (!Array.isArray(record.edits) || record.edits.length === 0) {
                    throw new Error('edits must contain at least one replacement.');
                }
                const original = await readFile(filePath, 'utf8');
                const ending = original.includes('\r\n') ? '\r\n' : '\n';
                let next = original;
                for (const [index, raw] of record.edits.entries()) {
                    const edit = assertRecord(raw, `edits[${index}]`);
                    const oldText = normalizeLineEndings(stringField(edit, 'oldText'), ending);
                    const newText = normalizeLineEndings(stringField(edit, 'newText'), ending);
                    if (!oldText)
                        throw new Error(`edits[${index}].oldText must not be empty.`);
                    const count = next.split(oldText).length - 1;
                    if (count === 0)
                        throw new Error(`Could not find edits[${index}] in ${filePath}.`);
                    if (count > 1)
                        throw new Error(`Found ${count} occurrences of edits[${index}] in ${filePath}.`);
                    next = next.replace(oldText, newText);
                }
                await writeFile(filePath, next, 'utf8');
                return {
                    path: path.relative(root, filePath),
                    replacements: record.edits.length,
                    diff: simpleDiff(original, next)
                };
            }
        },
        [options.listToolName ?? 'list_files']: {
            description: 'List files inside workspace root. Recursive mode walks directories and skips common generated folders.',
            inputSchema: objectSchema({
                path: { type: 'string' },
                recursive: { type: 'boolean' },
                maxEntries: { type: 'integer', minimum: 1 }
            }),
            execute: async (input) => {
                const record = assertRecord(input, 'list_files');
                const start = insideRoot(root, stringField(record, 'path', false) ?? '.');
                const recursive = booleanField(record, 'recursive', false);
                const maxEntries = numberField(record, 'maxEntries', 500);
                const files = [];
                async function walk(dir) {
                    if (files.length >= maxEntries)
                        return;
                    const entries = await readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (files.length >= maxEntries)
                            return;
                        if (entry.name === 'node_modules' || entry.name === '.git')
                            continue;
                        const fullPath = path.join(dir, entry.name);
                        const relative = path.relative(root, fullPath);
                        if (entry.isDirectory()) {
                            files.push(`${relative}/`);
                            if (recursive)
                                await walk(fullPath);
                            continue;
                        }
                        files.push(relative);
                    }
                }
                await walk(start);
                return {
                    root: path.relative(root, start) || '.',
                    files
                };
            }
        },
        [options.grepToolName ?? 'grep_files']: {
            description: 'Search UTF-8 text files inside workspace root by literal substring.',
            inputSchema: objectSchema({
                pattern: { type: 'string' },
                path: { type: 'string' },
                caseSensitive: { type: 'boolean' },
                maxMatches: { type: 'integer', minimum: 1 }
            }, ['pattern']),
            execute: async (input) => {
                const record = assertRecord(input, 'grep_files');
                const pattern = stringField(record, 'pattern');
                const start = insideRoot(root, stringField(record, 'path', false) ?? '.');
                const caseSensitive = booleanField(record, 'caseSensitive', true);
                const maxMatches = numberField(record, 'maxMatches', 200);
                const needle = caseSensitive ? pattern : pattern.toLowerCase();
                const matches = [];
                async function scan(filePath) {
                    if (matches.length >= maxMatches)
                        return;
                    const file = await readFile(filePath);
                    if (file.includes(0))
                        return;
                    const lines = file.toString('utf8').split(/\r?\n/);
                    for (let index = 0; index < lines.length; index++) {
                        const line = lines[index] ?? '';
                        const haystack = caseSensitive ? line : line.toLowerCase();
                        if (!haystack.includes(needle))
                            continue;
                        matches.push({
                            path: path.relative(root, filePath),
                            line: index + 1,
                            text: line
                        });
                        if (matches.length >= maxMatches)
                            return;
                    }
                }
                async function walk(target) {
                    if (matches.length >= maxMatches)
                        return;
                    const info = await stat(target);
                    if (info.isFile()) {
                        await scan(target);
                        return;
                    }
                    if (!info.isDirectory())
                        return;
                    const entries = await readdir(target, { withFileTypes: true });
                    for (const entry of entries) {
                        if (entry.name === 'node_modules' || entry.name === '.git')
                            continue;
                        await walk(path.join(target, entry.name));
                    }
                }
                await access(start, constants.R_OK);
                await walk(start);
                return { matches };
            }
        }
    };
    return options => ({
        ...options,
        tools: { ...(options.tools ?? {}), ...tools }
    });
}
function insideRoot(root, requestedPath) {
    const resolved = path.resolve(root, requestedPath);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Path escapes workspace root: ${requestedPath}`);
    }
    return resolved;
}
function normalizeLineEndings(text, ending) {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return ending === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized;
}
function simpleDiff(before, after) {
    if (before === after)
        return '';
    return [
        '--- before',
        '+++ after',
        ...before.split(/\r?\n/).map(line => `-${line}`),
        ...after.split(/\r?\n/).map(line => `+${line}`)
    ].join('\n');
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
function stringField(input, key, required = true) {
    const value = input[key];
    if (typeof value === 'string')
        return value;
    if (!required && value === undefined)
        return undefined;
    throw new Error(`${key} must be a string.`);
}
function booleanField(input, key, fallback) {
    const value = input[key];
    if (value === undefined)
        return fallback;
    if (typeof value === 'boolean')
        return value;
    throw new Error(`${key} must be a boolean.`);
}
function numberField(input, key, fallback) {
    const value = input[key];
    if (value === undefined)
        return fallback;
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    throw new Error(`${key} must be a number.`);
}
