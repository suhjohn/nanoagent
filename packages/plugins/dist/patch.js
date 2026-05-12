// Origin:
// - Codex: codex-rs/apply-patch/src/parser.rs, lib.rs, seek_sequence.rs
// - OpenCode: packages/opencode/src/patch/index.ts
// Behavior: parse Begin Patch grammar, derive context-aware replacements, apply rooted filesystem changes.
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
export function withApplyPatchTool(params) {
    const root = path.resolve(params.root);
    const toolName = params.toolName ?? 'apply_patch';
    const tool = {
        description: 'Apply patch in Begin Patch/End Patch grammar with Add File, Delete File, Update File, Move to, and End of File hunks.',
        inputSchema: objectSchema({ patch: { type: 'string' } }, ['patch']),
        execute: async (input) => {
            const record = assertRecord(input, toolName);
            return applyPatch({ root, patch: stringField(record, 'patch') });
        }
    };
    return options => ({
        ...options,
        tools: { ...(options.tools ?? {}), [toolName]: tool }
    });
}
export async function applyPatch(params) {
    const root = path.resolve(params.root);
    const hunks = parsePatch(params.patch);
    const pending = new Map();
    const changedFiles = [];
    const readPending = async (requestedPath) => {
        const file = inside(root, requestedPath);
        if (pending.has(file)) {
            const content = pending.get(file);
            if (content === undefined)
                throw new Error(`File was deleted: ${requestedPath}`);
            return content;
        }
        try {
            const info = await stat(file);
            if (!info.isFile())
                throw new Error(`Patch path is not a file: ${requestedPath}`);
            return await readFile(file, 'utf8');
        }
        catch (cause) {
            if (cause instanceof Error && cause.message.startsWith('Patch path')) {
                throw cause;
            }
            throw new Error(`Failed to read file: ${requestedPath}`, { cause });
        }
    };
    for (const hunk of hunks) {
        if (hunk.type === 'add') {
            pending.set(inside(root, hunk.path), hunk.content);
            changedFiles.push(hunk.path);
            continue;
        }
        if (hunk.type === 'delete') {
            await readPending(hunk.path);
            pending.set(inside(root, hunk.path), undefined);
            changedFiles.push(hunk.path);
            continue;
        }
        const oldFile = inside(root, hunk.path);
        const nextContent = deriveNewContent({
            content: await readPending(hunk.path),
            chunks: hunk.chunks,
            filePath: hunk.path
        });
        if (hunk.movePath) {
            const newFile = inside(root, hunk.movePath);
            if (oldFile !== newFile)
                pending.set(oldFile, undefined);
            pending.set(newFile, nextContent);
            changedFiles.push(hunk.movePath);
            continue;
        }
        pending.set(oldFile, nextContent);
        changedFiles.push(hunk.path);
    }
    for (const [file, content] of pending) {
        if (content === undefined) {
            await rm(file);
            continue;
        }
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, content, 'utf8');
    }
    const uniqueChangedFiles = [...new Set(changedFiles)];
    return {
        changedFiles: uniqueChangedFiles,
        output: `Applied patch to ${uniqueChangedFiles.length} file(s).`
    };
}
export function parsePatch(patch) {
    const lines = stripHeredoc(patch)
        .trim()
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n');
    if (lines.at(0)?.trim() !== '*** Begin Patch') {
        throw new Error("The first line of the patch must be '*** Begin Patch'");
    }
    if (lines.at(-1)?.trim() !== '*** End Patch') {
        throw new Error("The last line of the patch must be '*** End Patch'");
    }
    const hunks = [];
    for (let index = 1; index < lines.length - 1;) {
        const line = lines[index]?.trim();
        if (!line) {
            index++;
            continue;
        }
        if (line.startsWith('*** Add File: ')) {
            const filePath = requiredPath(line.slice('*** Add File: '.length), line);
            const content = [];
            for (index++; index < lines.length - 1; index++) {
                const next = lines[index] ?? '';
                if (!next.startsWith('+'))
                    break;
                content.push(next.slice(1));
            }
            if (content.length === 0)
                throw new Error(`Add file hunk is empty: ${filePath}`);
            hunks.push({
                type: 'add',
                path: filePath,
                content: `${content.join('\n')}\n`
            });
            continue;
        }
        if (line.startsWith('*** Delete File: ')) {
            hunks.push({
                type: 'delete',
                path: requiredPath(line.slice('*** Delete File: '.length), line)
            });
            index++;
            continue;
        }
        if (line.startsWith('*** Update File: ')) {
            const filePath = requiredPath(line.slice('*** Update File: '.length), line);
            let movePath;
            index++;
            if (lines[index]?.startsWith('*** Move to: ')) {
                movePath = requiredPath(lines[index].slice('*** Move to: '.length), lines[index]);
                index++;
            }
            const chunks = [];
            while (index < lines.length - 1) {
                const next = lines[index] ?? '';
                if (!next.trim()) {
                    index++;
                    continue;
                }
                if (next.startsWith('*** '))
                    break;
                const parsed = parseUpdateChunk({
                    lines,
                    index,
                    allowMissingContext: chunks.length === 0
                });
                chunks.push(parsed.chunk);
                index = parsed.index;
            }
            if (chunks.length === 0)
                throw new Error(`Update file hunk is empty: ${filePath}`);
            hunks.push({ type: 'update', path: filePath, movePath, chunks });
            continue;
        }
        throw new Error(`Unknown patch directive: ${lines[index]}`);
    }
    if (hunks.length === 0)
        throw new Error('Patch must contain at least one hunk');
    return hunks;
}
function parseUpdateChunk(params) {
    const first = params.lines[params.index] ?? '';
    const chunk = { oldLines: [], newLines: [], eof: false };
    let index = params.index;
    if (first === '@@') {
        index++;
    }
    else if (first.startsWith('@@ ')) {
        chunk.context = first.slice(3);
        index++;
    }
    else if (!params.allowMissingContext) {
        throw new Error(`Expected update hunk to start with @@, got: ${first}`);
    }
    let parsedLines = 0;
    for (; index < params.lines.length - 1; index++) {
        const line = params.lines[index] ?? '';
        if (line === '*** End of File') {
            if (parsedLines === 0)
                throw new Error('Update hunk does not contain any lines');
            chunk.eof = true;
            index++;
            break;
        }
        if (line === '@@' || line.startsWith('@@ ') || line.startsWith('*** '))
            break;
        if (line === '') {
            chunk.oldLines.push('');
            chunk.newLines.push('');
        }
        else if (line.startsWith(' ')) {
            chunk.oldLines.push(line.slice(1));
            chunk.newLines.push(line.slice(1));
        }
        else if (line.startsWith('-')) {
            chunk.oldLines.push(line.slice(1));
        }
        else if (line.startsWith('+')) {
            chunk.newLines.push(line.slice(1));
        }
        else if (parsedLines === 0) {
            throw new Error(`Unexpected line in update hunk: ${line}. Lines must start with space, +, or -.`);
        }
        else {
            break;
        }
        parsedLines++;
    }
    if (parsedLines === 0)
        throw new Error('Update hunk does not contain any lines');
    return { chunk, index };
}
function deriveNewContent(params) {
    const bom = params.content.startsWith('\uFEFF') ? '\uFEFF' : '';
    const body = bom ? params.content.slice(1) : params.content;
    const originalLines = body.split('\n');
    if (originalLines.at(-1) === '')
        originalLines.pop();
    const replacements = [];
    let lineIndex = 0;
    for (const chunk of params.chunks) {
        if (chunk.context !== undefined) {
            const contextIndex = seekSequence({
                lines: originalLines,
                pattern: [chunk.context],
                start: lineIndex
            });
            if (contextIndex === -1) {
                throw new Error(`Failed to find context '${chunk.context}' in ${params.filePath}`);
            }
            lineIndex = contextIndex + 1;
        }
        if (chunk.oldLines.length === 0) {
            replacements.push({
                start: originalLines.length,
                oldLength: 0,
                lines: chunk.newLines
            });
            continue;
        }
        let oldLines = chunk.oldLines;
        let newLines = chunk.newLines;
        let start = seekSequence({
            lines: originalLines,
            pattern: oldLines,
            start: lineIndex,
            eof: chunk.eof
        });
        if (start === -1 && oldLines.at(-1) === '') {
            oldLines = oldLines.slice(0, -1);
            if (newLines.at(-1) === '')
                newLines = newLines.slice(0, -1);
            start = seekSequence({
                lines: originalLines,
                pattern: oldLines,
                start: lineIndex,
                eof: chunk.eof
            });
        }
        if (start === -1) {
            throw new Error(`Failed to find expected lines in ${params.filePath}:\n${chunk.oldLines.join('\n')}`);
        }
        replacements.push({ start, oldLength: oldLines.length, lines: newLines });
        lineIndex = start + oldLines.length;
    }
    const nextLines = [...originalLines];
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
        nextLines.splice(replacement.start, replacement.oldLength, ...replacement.lines);
    }
    if (nextLines.at(-1) !== '')
        nextLines.push('');
    return bom + nextLines.join('\n');
}
function seekSequence(params) {
    if (params.pattern.length === 0)
        return params.start;
    if (params.pattern.length > params.lines.length)
        return -1;
    const compare = [
        (left, right) => left === right,
        (left, right) => left.trimEnd() === right.trimEnd(),
        (left, right) => left.trim() === right.trim(),
        (left, right) => normalizeUnicode(left.trim()) === normalizeUnicode(right.trim())
    ];
    for (const match of compare) {
        const found = findSequence({ ...params, match });
        if (found !== -1)
            return found;
    }
    return -1;
}
function findSequence(params) {
    const lastStart = params.lines.length - params.pattern.length;
    if (params.eof && lastStart >= params.start) {
        let ok = true;
        for (let offset = 0; offset < params.pattern.length; offset++) {
            if (!params.match(params.lines[lastStart + offset], params.pattern[offset])) {
                ok = false;
                break;
            }
        }
        if (ok)
            return lastStart;
    }
    for (let index = params.start; index <= lastStart; index++) {
        let ok = true;
        for (let offset = 0; offset < params.pattern.length; offset++) {
            if (!params.match(params.lines[index + offset], params.pattern[offset])) {
                ok = false;
                break;
            }
        }
        if (ok)
            return index;
    }
    return -1;
}
function normalizeUnicode(value) {
    return value
        .replace(/[\u2010-\u2015\u2212]/g, '-')
        .replace(/[\u2018-\u201B]/g, "'")
        .replace(/[\u201C-\u201F]/g, '"')
        .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, ' ')
        .replace(/\u2026/g, '...');
}
function stripHeredoc(patch) {
    const match = patch
        .trim()
        .match(/^(?:\S+\s+)?<<['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*\n([\s\S]*?)\n\1\s*$/);
    return match?.[2] ?? patch;
}
function requiredPath(value, line) {
    const filePath = value.trim();
    if (filePath)
        return filePath;
    throw new Error(`Missing path in patch directive: ${line}`);
}
function inside(root, requestedPath) {
    const resolved = path.resolve(root, requestedPath);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Patch path escapes root: ${requestedPath}`);
    }
    return resolved;
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
