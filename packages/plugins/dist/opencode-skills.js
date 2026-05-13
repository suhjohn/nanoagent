// Origin:
// - OpenCode: packages/opencode/src/skill/index.ts, tool/skill.ts, session/system.ts
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export function withOpenCodeSkills(params = {}) {
    const toolName = params.toolName ?? 'skill';
    const cwd = params.cwd ?? process.cwd();
    const fileSampleLimit = params.fileSampleLimit ?? 10;
    const load = memoize(() => loadOpenCodeSkills({
        cwd,
        dirs: params.dirs,
        urls: params.urls,
        includeGlobal: params.includeGlobal ?? true,
        includeProjectAncestors: params.includeProjectAncestors ?? true
    }));
    const catalogPlugin = withTurnPrepared(async ({ args, value }) => {
        if (params.includeCatalog === false)
            return { value };
        const { skills } = await load();
        const visible = await filterAllowedSkills({
            skills,
            allow: params.allow,
            context: args.context
        });
        if (!visible.length)
            return { value };
        return {
            value: prependMessages(value, [
                message('system', renderOpenCodeSkillCatalog(visible))
            ])
        };
    });
    const toolPlugin = options => ({
        ...options,
        tools: {
            ...(options.tools ?? {}),
            [toolName]: buildSkillTool({
                toolName,
                load,
                allow: params.allow,
                fileSampleLimit
            })
        }
    });
    return options => toolPlugin(catalogPlugin(options));
}
export async function loadOpenCodeSkills(params) {
    const diagnostics = [];
    const byName = new Map();
    for (const dir of openCodeSkillRoots(params)) {
        for (const filePath of await findSkillFiles(dir)) {
            collectSkill(byName, diagnostics, await readOpenCodeSkill(filePath));
        }
    }
    for (const url of params.urls ?? []) {
        collectSkill(byName, diagnostics, await readOpenCodeSkillUrl(url));
    }
    return {
        skills: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
        diagnostics
    };
}
function collectSkill(byName, diagnostics, loaded) {
    diagnostics.push(...loaded.diagnostics);
    if (loaded.skill)
        byName.set(loaded.skill.name, loaded.skill);
}
function buildSkillTool(params) {
    const { toolName, load, allow, fileSampleLimit } = params;
    return {
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
            const skill = findSkillOrThrow(skills, name);
            await assertAllowed({
                allow,
                name,
                skill,
                context: options.experimental_context
            });
            return renderSkillToolOutput({ skill, fileSampleLimit });
        }
    };
}
function findSkillOrThrow(skills, name) {
    const skill = skills.find(item => item.name === name);
    if (skill)
        return skill;
    const available = skills.map(item => item.name).join(', ');
    throw new Error(`Unknown skill "${name}". Available skills: ${available}`);
}
async function assertAllowed(params) {
    if (!params.allow)
        return;
    const decision = await params.allow({
        name: params.name,
        skill: params.skill,
        context: params.context
    });
    if (decision?.allow === false) {
        throw new Error(`Skill "${params.name}" denied.`);
    }
}
async function filterAllowedSkills(params) {
    if (!params.allow)
        return [...params.skills];
    const visible = [];
    for (const skill of params.skills) {
        const decision = await params.allow({
            name: skill.name,
            skill,
            context: params.context
        });
        if (decision?.allow !== false)
            visible.push(skill);
    }
    return visible;
}
async function renderSkillToolOutput(params) {
    const { skill, fileSampleLimit } = params;
    const remote = isHttpUrl(skill.filePath);
    const directory = remote
        ? new URL('.', skill.filePath).href
        : path.dirname(skill.filePath);
    const directoryHref = remote ? directory : pathToFileURL(directory).href;
    const files = remote
        ? []
        : await sampleSkillFiles({ dir: directory, limit: fileSampleLimit });
    return {
        name: skill.name,
        description: skill.description,
        location: skillLocation(skill.filePath),
        directory: directoryHref,
        content: `<skill_content name="${skill.name}">\n${skill.content}\n</skill_content>`,
        note: `Relative references are resolved from ${directory}.`,
        files
    };
}
function openCodeSkillRoots(params) {
    const cwd = params.cwd ?? process.cwd();
    const roots = [];
    if (params.includeGlobal !== false) {
        roots.push(...skillDirsFor(homedir()));
    }
    if (params.includeProjectAncestors !== false) {
        for (const dir of ancestors(cwd))
            roots.push(...skillDirsFor(dir));
    }
    for (const dir of params.dirs ?? []) {
        roots.push(resolvePath({ cwd, path: dir }));
    }
    return [...new Set(roots)];
}
function skillDirsFor(base) {
    return [path.join(base, '.claude'), path.join(base, '.agents')];
}
async function readOpenCodeSkill(filePath) {
    const raw = await readFile(filePath, 'utf8');
    return skillFromRaw({ raw, filePath, fallbackName: undefined });
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
    const fallbackName = path.basename(new URL(url).pathname, '.md');
    return skillFromRaw({
        raw,
        filePath: url,
        fallbackName,
        missingMessage: 'Skill URL requires string name and description frontmatter.'
    });
}
function skillFromRaw(params) {
    const { frontmatter, body } = frontmatterBlock(params.raw);
    const name = stringFrontmatter(frontmatter, 'name') ?? params.fallbackName ?? '';
    const description = stringFrontmatter(frontmatter, 'description') ?? '';
    if (!name || !description) {
        return {
            diagnostics: [
                {
                    type: 'warning',
                    message: params.missingMessage ??
                        'Skill requires string name and description frontmatter.',
                    path: params.filePath
                }
            ]
        };
    }
    return {
        diagnostics: [],
        skill: {
            name,
            description,
            content: body.trim(),
            filePath: params.filePath
        }
    };
}
function stringFrontmatter(frontmatter, key) {
    const value = frontmatter[key];
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
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
    const items = skills.map(renderSkillEntry).join('\n');
    return `<available_skills>\n${items}\n</available_skills>`;
}
function renderSkillEntry(skill) {
    const name = escapeXml(skill.name);
    const description = escapeXml(skill.description);
    const location = escapeXml(skillLocation(skill.filePath));
    return `<skill>\n<name>${name}</name>\n<description>${description}</description>\n<location>${location}</location>\n</skill>`;
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
    if (params.path.startsWith('~/')) {
        return path.join(homedir(), params.path.slice(2));
    }
    if (path.isAbsolute(params.path))
        return params.path;
    return path.resolve(params.cwd, params.path);
}
function skillLocation(filePath) {
    return isHttpUrl(filePath) ? filePath : pathToFileURL(filePath).href;
}
function isHttpUrl(value) {
    return value.startsWith('http://') || value.startsWith('https://');
}
function frontmatterBlock(raw) {
    const empty = {};
    if (!raw.startsWith('---\n'))
        return { frontmatter: empty, body: raw };
    const end = raw.indexOf('\n---\n', 4);
    if (end < 0)
        return { frontmatter: empty, body: raw };
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
        output[key] = parseYamlScalar(line.slice(split + 1).trim());
    }
    return output;
}
function parseYamlScalar(value) {
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    return unquote(value);
}
function unquote(value) {
    const quoted = (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"));
    return quoted ? value.slice(1, -1) : value;
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
function memoize(fn) {
    let promise;
    return () => (promise ??= fn());
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
