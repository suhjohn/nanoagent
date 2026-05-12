// Origin:
// - OpenCode: packages/opencode/src/skill/index.ts, tool/skill.ts, session/system.ts
// Behavior: discover SKILL.md files, inject available skill catalog, and expose explicit skill tool.
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export function withOpenCodeSkills(params = {}) {
    const toolName = params.toolName ?? 'skill';
    const cwd = params.cwd ?? process.cwd();
    const fileSampleLimit = params.fileSampleLimit ?? 10;
    let cached;
    const load = () => (cached ??= loadOpenCodeSkills({
        cwd,
        dirs: params.dirs,
        urls: params.urls,
        includeGlobal: params.includeGlobal ?? true,
        includeProjectAncestors: params.includeProjectAncestors ?? true
    }));
    const plugins = [
        withTurnPrepared(async ({ args, value }) => {
            if (params.includeCatalog === false)
                return { value };
            const { skills } = await load();
            const visible = [];
            for (const skill of skills) {
                const decision = await params.allow?.({
                    name: skill.name,
                    skill,
                    context: args.context
                });
                if (decision?.allow === false)
                    continue;
                visible.push(skill);
            }
            if (!visible.length)
                return { value };
            return {
                value: prependMessages(value, [
                    message('system', renderOpenCodeSkillCatalog(visible))
                ])
            };
        }),
        options => ({
            ...options,
            tools: {
                ...(options.tools ?? {}),
                [toolName]: {
                    description: 'Load full instructions for one available skill by name. Use when task matches listed skill description.',
                    inputSchema: objectSchema({
                        name: {
                            type: 'string',
                            description: 'Skill name exactly as listed in available skills.'
                        }
                    }, ['name']),
                    execute: async (input, options) => {
                        const record = assertRecord(input, toolName);
                        const name = stringField(record, 'name');
                        const { skills } = await load();
                        const skill = skills.find(item => item.name === name);
                        if (!skill) {
                            throw new Error(`Unknown skill "${name}". Available skills: ${skills
                                .map(item => item.name)
                                .join(', ')}`);
                        }
                        const decision = await params.allow?.({
                            name,
                            skill,
                            context: options.experimental_context
                        });
                        if (decision?.allow === false)
                            throw new Error(`Skill "${name}" denied.`);
                        const remote = isHttpUrl(skill.filePath);
                        const directory = remote
                            ? new URL('.', skill.filePath).href
                            : path.dirname(skill.filePath);
                        return {
                            name: skill.name,
                            description: skill.description,
                            location: skillLocation(skill.filePath),
                            directory: remote ? directory : pathToFileURL(directory).href,
                            content: `<skill_content name="${skill.name}">\n${skill.content}\n</skill_content>`,
                            note: `Relative references are resolved from ${directory}.`,
                            files: remote
                                ? []
                                : await sampleSkillFiles({
                                    dir: directory,
                                    limit: fileSampleLimit
                                })
                        };
                    }
                }
            }
        })
    ];
    return options => plugins.reduce((next, plugin) => plugin(next), options);
}
export async function loadOpenCodeSkills(params) {
    const diagnostics = [];
    const byName = new Map();
    for (const dir of openCodeSkillRoots(params)) {
        for (const filePath of await findSkillFiles(dir)) {
            const loaded = await readOpenCodeSkill(filePath);
            diagnostics.push(...loaded.diagnostics);
            if (loaded.skill)
                byName.set(loaded.skill.name, loaded.skill);
        }
    }
    for (const url of params.urls ?? []) {
        const loaded = await readOpenCodeSkillUrl(url);
        diagnostics.push(...loaded.diagnostics);
        if (loaded.skill)
            byName.set(loaded.skill.name, loaded.skill);
    }
    return {
        skills: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
        diagnostics
    };
}
function openCodeSkillRoots(params) {
    const cwd = params.cwd ?? process.cwd();
    const roots = [];
    if (params.includeGlobal !== false) {
        roots.push(path.join(homedir(), '.claude'), path.join(homedir(), '.agents'));
    }
    if (params.includeProjectAncestors !== false) {
        for (const dir of ancestors(cwd)) {
            roots.push(path.join(dir, '.claude'), path.join(dir, '.agents'));
        }
    }
    roots.push(...(params.dirs ?? []).map(dir => resolvePath({ cwd, path: dir })));
    return [...new Set(roots)];
}
async function readOpenCodeSkill(filePath) {
    const raw = await readFile(filePath, 'utf8');
    const { frontmatter, body } = frontmatterBlock(raw);
    const diagnostics = [];
    const name = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '';
    const description = typeof frontmatter.description === 'string'
        ? frontmatter.description.trim()
        : '';
    if (!name || !description) {
        diagnostics.push({
            type: 'warning',
            message: 'Skill requires string name and description frontmatter.',
            path: filePath
        });
        return { diagnostics };
    }
    return {
        diagnostics,
        skill: { name, description, content: body.trim(), filePath }
    };
}
async function readOpenCodeSkillUrl(url) {
    const response = await fetch(url);
    if (!response.ok) {
        return {
            diagnostics: [
                {
                    type: 'warning',
                    message: `Skill URL returned ${response.status}.`,
                    path: url
                }
            ]
        };
    }
    const raw = await response.text();
    const { frontmatter, body } = frontmatterBlock(raw);
    const name = typeof frontmatter.name === 'string'
        ? frontmatter.name.trim()
        : path.basename(new URL(url).pathname, '.md');
    const description = typeof frontmatter.description === 'string'
        ? frontmatter.description.trim()
        : '';
    if (!name || !description) {
        return {
            diagnostics: [
                {
                    type: 'warning',
                    message: 'Skill URL requires string name and description frontmatter.',
                    path: url
                }
            ]
        };
    }
    return {
        diagnostics: [],
        skill: { name, description, content: body.trim(), filePath: url }
    };
}
async function findSkillFiles(root) {
    const files = [];
    await walkFiles({
        dir: root,
        visit: filePath => {
            if (path.basename(filePath) === 'SKILL.md')
                files.push(filePath);
        }
    });
    return files.sort((a, b) => a.localeCompare(b));
}
async function sampleSkillFiles(params) {
    if (params.limit <= 0)
        return [];
    const files = [];
    await walkFiles({
        dir: params.dir,
        visit: filePath => {
            if (files.length >= params.limit)
                return;
            if (path.basename(filePath) === 'SKILL.md')
                return;
            files.push(path.relative(params.dir, filePath));
        }
    });
    return files.sort((a, b) => a.localeCompare(b)).slice(0, params.limit);
}
async function walkFiles(params) {
    const info = await stat(params.dir).catch(() => undefined);
    if (!info?.isDirectory())
        return;
    const entries = await readdir(params.dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules')
            continue;
        const full = path.join(params.dir, entry.name);
        if (entry.isDirectory())
            await walkFiles({ dir: full, visit: params.visit });
        else if (entry.isFile())
            params.visit(full);
    }
}
function renderOpenCodeSkillCatalog(skills) {
    return `<available_skills>\n${skills
        .map(skill => `<skill>\n<name>${escapeXml(skill.name)}</name>\n<description>${escapeXml(skill.description)}</description>\n<location>${escapeXml(skillLocation(skill.filePath))}</location>\n</skill>`)
        .join('\n')}\n</available_skills>`;
}
function ancestors(start) {
    const dirs = [];
    for (let current = path.resolve(start);; current = path.dirname(current)) {
        dirs.push(current);
        if (path.dirname(current) === current)
            return dirs;
    }
}
function resolvePath(params) {
    if (params.path === '~')
        return homedir();
    if (params.path.startsWith('~/'))
        return path.join(homedir(), params.path.slice(2));
    return path.isAbsolute(params.path)
        ? params.path
        : path.resolve(params.cwd, params.path);
}
function skillLocation(filePath) {
    return isHttpUrl(filePath) ? filePath : pathToFileURL(filePath).href;
}
function isHttpUrl(value) {
    return value.startsWith('http://') || value.startsWith('https://');
}
function frontmatterBlock(raw) {
    if (!raw.startsWith('---\n'))
        return { frontmatter: {}, body: raw };
    const end = raw.indexOf('\n---\n', 4);
    if (end < 0)
        return { frontmatter: {}, body: raw };
    return {
        frontmatter: parseFlatYaml(raw.slice(4, end)),
        body: raw.slice(end + 5)
    };
}
function parseFlatYaml(raw) {
    const output = {};
    for (const line of raw.split('\n')) {
        const split = line.indexOf(':');
        if (split < 0)
            continue;
        const key = line.slice(0, split).trim();
        const value = line.slice(split + 1).trim();
        output[key] =
            value === 'true' ? true : value === 'false' ? false : unquote(value);
    }
    return output;
}
function unquote(value) {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}
function escapeXml(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
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
function prependMessages(value, messages) {
    return {
        ...value,
        messages: [...messages, ...(value.messages ?? [])]
    };
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
