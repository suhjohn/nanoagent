// Origin:
// - Pi: packages/coding-agent/src/core/resource-loader.ts skills support
// - OpenCode: packages/opencode/src/skill/index.ts
// Behavior: discover generic SKILL.md files and inject selected skill bodies into system prompt.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const SKILL_NAME_MAX = 64;
const SKILL_DESCRIPTION_MAX = 1024;
const FRONTMATTER_OPEN = '---\n';
const FRONTMATTER_CLOSE = '\n---\n';
export async function loadSkills(dirs) {
    const result = { skills: [], diagnostics: [] };
    for (const dir of dirs)
        await collectSkills(dir, result);
    return result;
}
export function withDiscoveredSkills(params) {
    const load = memoize(() => loadSkills(params.dirs));
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
                const { skills } = await load();
                const invokable = skills.filter(skill => !skill.disableModelInvocation);
                if (!invokable.length)
                    return previous;
                return {
                    context: previous?.context,
                    value: prependMessages(value, [
                        message('system', renderCatalog(invokable))
                    ])
                };
            }
        }
    });
}
export function formatSkillInvocation(skill, additionalInstructions) {
    const body = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${path.dirname(skill.filePath)}.\n\n${skill.content}\n</skill>`;
    return additionalInstructions ? `${body}\n\n${additionalInstructions}` : body;
}
function renderCatalog(skills) {
    const lines = skills.map(skill => `- ${skill.name}: ${skill.description} (${skill.filePath})`);
    return `<available_skills>\n${lines.join('\n')}\n</available_skills>`;
}
async function collectSkills(dir, result) {
    const info = await stat(dir).catch(() => undefined);
    if (!info?.isDirectory())
        return;
    const entries = await readdir(dir, { withFileTypes: true });
    const skillFile = entries.find(entry => entry.isFile() && entry.name === 'SKILL.md');
    if (skillFile) {
        await appendSkill(path.join(dir, skillFile.name), result);
        return;
    }
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules')
            continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await collectSkills(full, result);
        }
        else if (entry.isFile() && entry.name.endsWith('.md')) {
            await appendSkill(full, result);
        }
    }
}
async function appendSkill(filePath, result) {
    const loaded = await loadSkill(filePath);
    if (loaded.skill)
        result.skills.push(loaded.skill);
    result.diagnostics.push(...loaded.diagnostics);
}
async function loadSkill(filePath) {
    const raw = await readFile(filePath, 'utf8');
    const { frontmatter, body } = frontmatterBlock(raw);
    const description = typeof frontmatter.description === 'string'
        ? frontmatter.description.trim()
        : '';
    if (!description) {
        return {
            skill: undefined,
            diagnostics: [
                {
                    type: 'warning',
                    message: 'Skill missing description.',
                    path: filePath
                }
            ]
        };
    }
    const name = String(frontmatter.name ?? path.basename(path.dirname(filePath))).slice(0, SKILL_NAME_MAX);
    return {
        skill: {
            name,
            description: description.slice(0, SKILL_DESCRIPTION_MAX),
            content: body,
            filePath,
            disableModelInvocation: frontmatter['disable-model-invocation'] === true
        },
        diagnostics: []
    };
}
function frontmatterBlock(raw) {
    if (!raw.startsWith(FRONTMATTER_OPEN))
        return { frontmatter: {}, body: raw };
    const end = raw.indexOf(FRONTMATTER_CLOSE, FRONTMATTER_OPEN.length);
    if (end < 0)
        return { frontmatter: {}, body: raw };
    const frontmatter = {};
    for (const line of raw.slice(FRONTMATTER_OPEN.length, end).split('\n')) {
        const split = line.indexOf(':');
        if (split < 0)
            continue;
        frontmatter[line.slice(0, split).trim()] = parseScalar(line.slice(split + 1).trim());
    }
    return { frontmatter, body: raw.slice(end + FRONTMATTER_CLOSE.length) };
}
function parseScalar(value) {
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    return value;
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
