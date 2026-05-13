// Origin:
// - Codex: codex-rs/apply-patch/src/parser.rs, lib.rs, seek_sequence.rs
// - OpenCode: packages/opencode/src/patch/index.ts
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
const ADD_FILE = '*** Add File: ';
const DELETE_FILE = '*** Delete File: ';
const UPDATE_FILE = '*** Update File: ';
const MOVE_TO = '*** Move to: ';
const END_OF_FILE = '*** End of File';
const BEGIN_PATCH = '*** Begin Patch';
const END_PATCH = '*** End Patch';
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
    const readPending = (requestedPath) => readPendingContent({ root, pending, requestedPath });
    for (const hunk of hunks) {
        await stageHunk({ hunk, root, pending, readPending, changedFiles });
    }
    await flushPending(pending);
    const uniqueChangedFiles = [...new Set(changedFiles)];
    return {
        changedFiles: uniqueChangedFiles,
        output: `Applied patch to ${uniqueChangedFiles.length} file(s).`
    };
}
async function readPendingContent(params) {
    const file = inside(params.root, params.requestedPath);
    if (params.pending.has(file)) {
        const content = params.pending.get(file);
        if (content === undefined) {
            throw new Error(`File was deleted: ${params.requestedPath}`);
        }
        return content;
    }
    const info = await statOrUndefined(file);
    if (info && !info.isFile()) {
        throw new Error(`Patch path is not a file: ${params.requestedPath}`);
    }
    try {
        return await readFile(file, 'utf8');
    }
    catch (cause) {
        throw new Error(`Failed to read file: ${params.requestedPath}`, { cause });
    }
}
async function statOrUndefined(file) {
    try {
        return await stat(file);
    }
    catch {
        return undefined;
    }
}
async function stageHunk(params) {
    const { hunk, root, pending, readPending, changedFiles } = params;
    if (hunk.type === 'add') {
        pending.set(inside(root, hunk.path), hunk.content);
        changedFiles.push(hunk.path);
        return;
    }
    if (hunk.type === 'delete') {
        await readPending(hunk.path);
        pending.set(inside(root, hunk.path), undefined);
        changedFiles.push(hunk.path);
        return;
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
        return;
    }
    pending.set(oldFile, nextContent);
    changedFiles.push(hunk.path);
}
async function flushPending(pending) {
    for (const [file, content] of pending) {
        if (content === undefined) {
            await rm(file);
            continue;
        }
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, content, 'utf8');
    }
}
export function parsePatch(patch) {
    const lines = normalizePatchLines(patch);
    assertPatchEnvelope(lines);
    const hunks = [];
    let index = 1;
    const limit = lines.length - 1;
    while (index < limit) {
        const line = lines[index]?.trim();
        if (!line) {
            index++;
            continue;
        }
        if (line.startsWith(ADD_FILE)) {
            const result = parseAddHunk(lines, index, limit);
            hunks.push(result.hunk);
            index = result.index;
            continue;
        }
        if (line.startsWith(DELETE_FILE)) {
            hunks.push({
                type: 'delete',
                path: requiredPath(line.slice(DELETE_FILE.length), line)
            });
            index++;
            continue;
        }
        if (line.startsWith(UPDATE_FILE)) {
            const result = parseUpdateHunk(lines, index, limit);
            hunks.push(result.hunk);
            index = result.index;
            continue;
        }
        throw new Error(`Unknown patch directive: ${lines[index]}`);
    }
    if (hunks.length === 0) {
        throw new Error('Patch must contain at least one hunk');
    }
    return hunks;
}
function normalizePatchLines(patch) {
    return stripHeredoc(patch)
        .trim()
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n');
}
function assertPatchEnvelope(lines) {
    if (lines.at(0)?.trim() !== BEGIN_PATCH) {
        throw new Error("The first line of the patch must be '*** Begin Patch'");
    }
    if (lines.at(-1)?.trim() !== END_PATCH) {
        throw new Error("The last line of the patch must be '*** End Patch'");
    }
}
function parseAddHunk(lines, startIndex, limit) {
    const directive = lines[startIndex] ?? '';
    const filePath = requiredPath(directive.slice(ADD_FILE.length), directive.trim());
    const content = [];
    let index = startIndex + 1;
    while (index < limit) {
        const next = lines[index] ?? '';
        if (!next.startsWith('+'))
            break;
        content.push(next.slice(1));
        index++;
    }
    if (content.length === 0) {
        throw new Error(`Add file hunk is empty: ${filePath}`);
    }
    return {
        hunk: { type: 'add', path: filePath, content: `${content.join('\n')}\n` },
        index
    };
}
function parseUpdateHunk(lines, startIndex, limit) {
    const directive = lines[startIndex] ?? '';
    const filePath = requiredPath(directive.slice(UPDATE_FILE.length), directive.trim());
    let index = startIndex + 1;
    let movePath;
    const moveLine = lines[index];
    if (moveLine?.startsWith(MOVE_TO)) {
        movePath = requiredPath(moveLine.slice(MOVE_TO.length), moveLine);
        index++;
    }
    const chunks = [];
    while (index < limit) {
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
    if (chunks.length === 0) {
        throw new Error(`Update file hunk is empty: ${filePath}`);
    }
    return { hunk: { type: 'update', path: filePath, movePath, chunks }, index };
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
    const limit = params.lines.length - 1;
    let parsedLines = 0;
    for (; index < limit; index++) {
        const line = params.lines[index] ?? '';
        if (line === END_OF_FILE) {
            if (parsedLines === 0) {
                throw new Error('Update hunk does not contain any lines');
            }
            chunk.eof = true;
            index++;
            break;
        }
        if (isChunkBoundary(line))
            break;
        const consumed = consumeChunkLine({ chunk, line, parsedLines });
        if (!consumed)
            break;
        parsedLines++;
    }
    if (parsedLines === 0) {
        throw new Error('Update hunk does not contain any lines');
    }
    return { chunk, index };
}
function isChunkBoundary(line) {
    return line === '@@' || line.startsWith('@@ ') || line.startsWith('*** ');
}
function consumeChunkLine(params) {
    const { chunk, line } = params;
    if (line === '') {
        chunk.oldLines.push('');
        chunk.newLines.push('');
        return true;
    }
    if (line.startsWith(' ')) {
        chunk.oldLines.push(line.slice(1));
        chunk.newLines.push(line.slice(1));
        return true;
    }
    if (line.startsWith('-')) {
        chunk.oldLines.push(line.slice(1));
        return true;
    }
    if (line.startsWith('+')) {
        chunk.newLines.push(line.slice(1));
        return true;
    }
    if (params.parsedLines === 0) {
        throw new Error(`Unexpected line in update hunk: ${line}. Lines must start with space, +, or -.`);
    }
    return false;
}
function deriveNewContent(params) {
    const { bom, lines: originalLines } = splitBomAndLines(params.content);
    const replacements = [];
    let lineIndex = 0;
    for (const chunk of params.chunks) {
        lineIndex = advancePastContext({
            chunk,
            originalLines,
            lineIndex,
            filePath: params.filePath
        });
        const replacement = buildReplacement({
            chunk,
            originalLines,
            lineIndex,
            filePath: params.filePath
        });
        replacements.push(replacement);
        lineIndex = replacement.start + replacement.oldLength;
    }
    return bom + applyReplacements(originalLines, replacements);
}
function splitBomAndLines(content) {
    const bom = content.startsWith('﻿') ? '﻿' : '';
    const body = bom ? content.slice(1) : content;
    const lines = body.split('\n');
    if (lines.at(-1) === '')
        lines.pop();
    return { bom, lines };
}
function advancePastContext(params) {
    if (params.chunk.context === undefined)
        return params.lineIndex;
    const contextIndex = seekSequence({
        lines: params.originalLines,
        pattern: [params.chunk.context],
        start: params.lineIndex
    });
    if (contextIndex === -1) {
        throw new Error(`Failed to find context '${params.chunk.context}' in ${params.filePath}`);
    }
    return contextIndex + 1;
}
function buildReplacement(params) {
    const { chunk, originalLines, lineIndex, filePath } = params;
    if (chunk.oldLines.length === 0) {
        return {
            start: originalLines.length,
            oldLength: 0,
            lines: chunk.newLines
        };
    }
    const located = locateOldLines({
        originalLines,
        oldLines: chunk.oldLines,
        newLines: chunk.newLines,
        start: lineIndex,
        eof: chunk.eof
    });
    if (located === undefined) {
        throw new Error(`Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join('\n')}`);
    }
    return {
        start: located.start,
        oldLength: located.oldLines.length,
        lines: located.newLines
    };
}
function locateOldLines(params) {
    const direct = seekSequence({
        lines: params.originalLines,
        pattern: params.oldLines,
        start: params.start,
        eof: params.eof
    });
    if (direct !== -1) {
        return {
            start: direct,
            oldLines: params.oldLines,
            newLines: params.newLines
        };
    }
    // Retry after trimming a trailing blank from the pattern (and matching new
    // lines) — patches sometimes include a phantom blank that doesn't exist at
    // EOF in the source.
    if (params.oldLines.at(-1) !== '')
        return undefined;
    const trimmedOld = params.oldLines.slice(0, -1);
    const trimmedNew = params.newLines.at(-1) === ''
        ? params.newLines.slice(0, -1)
        : params.newLines;
    const retry = seekSequence({
        lines: params.originalLines,
        pattern: trimmedOld,
        start: params.start,
        eof: params.eof
    });
    if (retry === -1)
        return undefined;
    return { start: retry, oldLines: trimmedOld, newLines: trimmedNew };
}
function applyReplacements(originalLines, replacements) {
    const nextLines = [...originalLines];
    const reversed = [...replacements].sort((a, b) => b.start - a.start);
    for (const replacement of reversed) {
        nextLines.splice(replacement.start, replacement.oldLength, ...replacement.lines);
    }
    if (nextLines.at(-1) !== '')
        nextLines.push('');
    return nextLines.join('\n');
}
function seekSequence(params) {
    if (params.pattern.length === 0)
        return params.start;
    if (params.pattern.length > params.lines.length)
        return -1;
    for (const match of LINE_MATCHERS) {
        const found = findSequence({ ...params, match });
        if (found !== -1)
            return found;
    }
    return -1;
}
const LINE_MATCHERS = [
    (left, right) => left === right,
    (left, right) => left.trimEnd() === right.trimEnd(),
    (left, right) => left.trim() === right.trim(),
    (left, right) => normalizeUnicode(left.trim()) === normalizeUnicode(right.trim())
];
function findSequence(params) {
    const lastStart = params.lines.length - params.pattern.length;
    if (params.eof && lastStart >= params.start) {
        if (matchAt(params, lastStart))
            return lastStart;
    }
    for (let index = params.start; index <= lastStart; index++) {
        if (matchAt(params, index))
            return index;
    }
    return -1;
}
function matchAt(params, start) {
    for (let offset = 0; offset < params.pattern.length; offset++) {
        if (!params.match(params.lines[start + offset], params.pattern[offset])) {
            return false;
        }
    }
    return true;
}
function normalizeUnicode(value) {
    return value
        .replace(/[‐-―−]/g, '-')
        .replace(/[‘-‛]/g, "'")
        .replace(/[“-‟]/g, '"')
        .replace(/[  -   　]/g, ' ')
        .replace(/…/g, '...');
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
