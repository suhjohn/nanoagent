// Origin:
// - Codex: codex-rs/core-skills/src/loader.rs, render.rs, injection.rs, model.rs
// Behavior: load scoped skills, render Codex-style instructions, and inject explicitly mentioned skill content.
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export function withCodexSkills(params = {}) {
    const cwd = params.cwd ?? process.cwd();
    const maxCatalogCharacters = params.maxCatalogCharacters ?? 8_000;
    let cached;
    const load = () => (cached ??= loadCodexSkills({
        cwd,
        roots: params.roots
    }));
    return withTurnPrepared(async ({ args, value }) => {
        if (params.enabled === false)
            return { value };
        const context = args.context;
        const disabled = new Set(params.disabledNames ?? []);
        const { skills } = await load();
        const available = skills.filter(skill => {
            if (disabled.has(skill.name))
                return false;
            if (!params.product)
                return true;
            return (!skill.policy.products.length ||
                skill.policy.products.includes(params.product));
        });
        if (!available.length)
            return { value };
        const mentions = collectSkillMentions({ value, skills: available });
        const messages = [];
        if (params.includeInstructions !== false) {
            messages.push(message('system', renderCodexSkillInstructions({
                skills: available,
                maxCharacters: maxCatalogCharacters
            })));
        }
        for (const skill of mentions) {
            await ensureSkillDependencies({ skill, context, params });
            messages.push(message('system', renderCodexSkillInjection(skill)));
        }
        if (!messages.length)
            return { value };
        return { value: prependMessages(value, messages) };
    });
}
export async function loadCodexSkills(params) {
    const diagnostics = [];
    const byPath = new Map();
    for (const root of codexSkillRoots(params)) {
        for (const filePath of await findCodexSkillFiles(root.path)) {
            const loaded = await readCodexSkill({ filePath, root });
            diagnostics.push(...loaded.diagnostics);
            if (loaded.skill)
                byPath.set(loaded.skill.filePath, loaded.skill);
        }
    }
    return {
        skills: [...byPath.values()].sort(compareCodexSkills),
        diagnostics
    };
}
export function renderCodexSkillInstructions(params) {
    const maxCharacters = params.maxCharacters ?? 8_000;
    const header = [
        '## Skills',
        '',
        'Skills provide specialized instructions. Use them when user request matches skill description. Mention a skill with `$skill-name` to load full instructions.',
        '',
        'Available skills:'
    ].join('\n');
    const lines = [];
    let size = header.length;
    for (const skill of params.skills) {
        const line = `- ${skill.name}: ${skill.shortDescription ?? skill.description} (${scopeLabel(skill)})`;
        if (size + line.length + 1 > maxCharacters)
            break;
        lines.push(line);
        size += line.length + 1;
    }
    return `${header}\n${lines.join('\n')}`;
}
export function collectSkillMentions(params) {
    const byName = new Map();
    for (const skill of params.skills) {
        byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill]);
    }
    const selected = new Map();
    const text = (params.value.messages ?? []).map(messageText).join('\n');
    for (const match of text.matchAll(/\$([A-Za-z0-9_.-]+)/g)) {
        const name = match[1];
        if (!name)
            continue;
        const matches = byName.get(name);
        if (matches?.length === 1)
            selected.set(matches[0].filePath, matches[0]);
    }
    for (const skill of params.skills) {
        if (text.includes(skill.filePath) ||
            text.includes(pathToFileURL(skill.filePath).href)) {
            selected.set(skill.filePath, skill);
        }
    }
    return [...selected.values()];
}
function codexSkillRoots(params) {
    const cwd = params.cwd ?? process.cwd();
    const explicit = params.roots ?? [];
    if (explicit.length) {
        return explicit.map(root => typeof root === 'string'
            ? { path: resolvePath({ cwd, path: root }), scope: 'repo' }
            : {
                ...root,
                path: resolvePath({ cwd, path: root.path })
            });
    }
    return [
        { path: path.join(cwd, '.codex', 'skills'), scope: 'repo' },
        { path: path.join(cwd, '.agents', 'skills'), scope: 'repo' },
        { path: path.join(homedir(), '.agents', 'skills'), scope: 'user' },
        {
            path: path.join(process.env.CODEX_HOME ?? path.join(homedir(), '.codex'), 'skills'),
            scope: 'user'
        },
        {
            path: path.join(process.env.CODEX_HOME ?? path.join(homedir(), '.codex'), 'skills', '.system'),
            scope: 'system'
        },
        { path: '/etc/codex/skills', scope: 'admin' }
    ];
}
async function readCodexSkill(params) {
    const raw = await readFile(params.filePath, 'utf8');
    const { frontmatter, body } = frontmatterBlock(raw);
    const metadata = await readCodexOpenAiMetadata(path.dirname(params.filePath));
    const diagnostics = [];
    const name = stringValue(frontmatter.name) ??
        path.basename(path.dirname(params.filePath));
    const description = stringValue(frontmatter.description) ?? stringValue(metadata.description);
    if (!description) {
        diagnostics.push({
            type: 'warning',
            message: 'Skill requires description frontmatter or agents/openai.yaml description.',
            path: params.filePath
        });
        return { diagnostics };
    }
    return {
        diagnostics,
        skill: {
            name: name.slice(0, 64),
            description: description.slice(0, 1024),
            shortDescription: stringValue(frontmatter.short_description) ??
                stringValue(metadata.short_description),
            content: body.trim(),
            filePath: params.filePath,
            scope: params.root.scope,
            pluginId: params.root.pluginId,
            policy: {
                allowImplicitInvocation: booleanValue(metadata.allow_implicit_invocation) ?? true,
                products: stringArrayValue(metadata.products)
            },
            dependencies: {
                env: stringArrayValue(metadata.env),
                tools: stringArrayValue(metadata.tools)
            }
        }
    };
}
async function readCodexOpenAiMetadata(dir) {
    const filePath = path.join(dir, 'agents', 'openai.yaml');
    const raw = await readFile(filePath, 'utf8').catch(() => '');
    return parseNestedYaml(raw);
}
async function findCodexSkillFiles(root) {
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
async function walkFiles(params) {
    const info = await stat(params.dir).catch(() => undefined);
    if (!info?.isDirectory())
        return;
    const entries = await readdir(params.dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === 'node_modules')
            continue;
        const full = path.join(params.dir, entry.name);
        if (entry.isDirectory())
            await walkFiles({ dir: full, visit: params.visit });
        else if (entry.isFile())
            params.visit(full);
    }
}
async function ensureSkillDependencies(args) {
    if (!args.skill.dependencies.env.length)
        return;
    const missing = [];
    for (const name of args.skill.dependencies.env) {
        const value = await args.params.resolveEnv?.({
            name,
            skill: args.skill,
            context: args.context
        });
        if (value === undefined)
            missing.push(name);
    }
    if (missing.length) {
        if (args.params.onMissingEnv) {
            await args.params.onMissingEnv({
                names: missing,
                skill: args.skill,
                context: args.context
            });
            return;
        }
        throw new Error(`Skill "${args.skill.name}" requires missing environment variables: ${missing.join(', ')}`);
    }
}
function renderCodexSkillInjection(skill) {
    const dir = path.dirname(skill.filePath);
    return [
        `<skill_content name="${escapeXml(skill.name)}" path="${escapeXml(skill.filePath)}">`,
        `References are relative to ${dir}.`,
        '',
        skill.content,
        '</skill_content>'
    ].join('\n');
}
function messageText(message) {
    if (!message || typeof message !== 'object')
        return '';
    const content = message.content;
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content))
        return content.map(contentPartText).join('\n');
    return '';
}
function contentPartText(part) {
    if (typeof part === 'string')
        return part;
    if (!part || typeof part !== 'object')
        return '';
    const text = part.text;
    return typeof text === 'string' ? text : '';
}
function compareCodexSkills(left, right) {
    const rank = scopeRank(left.scope) - scopeRank(right.scope);
    return rank || left.name.localeCompare(right.name);
}
function scopeRank(scope) {
    return { repo: 0, user: 1, plugin: 2, system: 3, admin: 4 }[scope];
}
function scopeLabel(skill) {
    return skill.pluginId ? `${skill.scope}:${skill.pluginId}` : skill.scope;
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
        output[line.slice(0, split).trim()] = scalarValue(line.slice(split + 1));
    }
    return output;
}
function parseNestedYaml(raw) {
    const output = {};
    const pathStack = [];
    for (const rawLine of raw.split('\n')) {
        if (!rawLine.trim() || rawLine.trimStart().startsWith('#'))
            continue;
        const indent = rawLine.length - rawLine.trimStart().length;
        const depth = Math.floor(indent / 2);
        pathStack.length = depth;
        const line = rawLine.trim();
        if (line.startsWith('- ')) {
            const key = pathStack[pathStack.length - 1];
            if (!key)
                continue;
            const values = (output[key] ?? []);
            output[key] = [...values, scalarValue(line.slice(2))];
            continue;
        }
        const split = line.indexOf(':');
        if (split < 0)
            continue;
        const key = line.slice(0, split).trim();
        const value = line.slice(split + 1);
        if (value.trim())
            output[key] = scalarValue(value);
        pathStack[depth] = key;
    }
    return output;
}
function scalarValue(raw) {
    const value = raw.trim();
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    if (value.startsWith('[') && value.endsWith(']')) {
        return value
            .slice(1, -1)
            .split(',')
            .map(item => unquote(item.trim()))
            .filter(Boolean);
    }
    return unquote(value);
}
function stringValue(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function booleanValue(value) {
    return typeof value === 'boolean' ? value : undefined;
}
function stringArrayValue(value) {
    return Array.isArray(value) && value.every(item => typeof item === 'string')
        ? value
        : [];
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
