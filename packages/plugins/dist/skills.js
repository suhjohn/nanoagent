// Origin:
// - Pi: packages/agent/src/harness/skills.ts, coding-agent/src/core/skills.ts
// Behavior: discover SKILL.md/direct Markdown skills, validate metadata, and inject skill catalog/invocation text.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
export async function loadSkills(dirs) {
    const skills = [];
    const diagnostics = [];
    for (const dir of dirs)
        await walk(dir, skills, diagnostics);
    return { skills, diagnostics };
}
export function withDiscoveredSkills(params) {
    let cached;
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
                cached ??= loadSkills(params.dirs);
                const { skills } = await cached;
                const invokable = skills.filter(skill => !skill.disableModelInvocation);
                if (!invokable.length)
                    return previous;
                const catalog = invokable
                    .map(skill => `- ${skill.name}: ${skill.description} (${skill.filePath})`)
                    .join('\n');
                return {
                    context: previous?.context,
                    value: prependMessages(value, [
                        message('system', `<available_skills>\n${catalog}\n</available_skills>`)
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
async function walk(dir, skills, diagnostics) {
    const info = await stat(dir).catch(() => undefined);
    if (!info?.isDirectory())
        return;
    const entries = await readdir(dir, { withFileTypes: true });
    const skill = entries.find(entry => entry.isFile() && entry.name === 'SKILL.md');
    if (skill) {
        const filePath = path.join(dir, skill.name);
        const loaded = await loadSkill(filePath);
        if (loaded.skill)
            skills.push(loaded.skill);
        diagnostics.push(...loaded.diagnostics);
        return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules')
            continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory())
            await walk(full, skills, diagnostics);
        else if (entry.isFile() && entry.name.endsWith('.md')) {
            const loaded = await loadSkill(full);
            if (loaded.skill)
                skills.push(loaded.skill);
            diagnostics.push(...loaded.diagnostics);
        }
    }
}
async function loadSkill(filePath) {
    const diagnostics = [];
    const raw = await readFile(filePath, 'utf8');
    const { frontmatter, body } = frontmatterBlock(raw);
    const name = String(frontmatter.name ?? path.basename(path.dirname(filePath))).slice(0, 64);
    const description = typeof frontmatter.description === 'string'
        ? frontmatter.description.trim()
        : '';
    if (!description) {
        diagnostics.push({
            type: 'warning',
            message: 'Skill missing description.',
            path: filePath
        });
        return { skill: undefined, diagnostics };
    }
    return {
        skill: {
            name,
            description: description.slice(0, 1024),
            content: body,
            filePath,
            disableModelInvocation: frontmatter['disable-model-invocation'] === true
        },
        diagnostics
    };
}
function frontmatterBlock(raw) {
    if (!raw.startsWith('---\n'))
        return { frontmatter: {}, body: raw };
    const end = raw.indexOf('\n---\n', 4);
    if (end < 0)
        return { frontmatter: {}, body: raw };
    const frontmatter = {};
    for (const line of raw.slice(4, end).split('\n')) {
        const split = line.indexOf(':');
        if (split < 0)
            continue;
        const key = line.slice(0, split).trim();
        const value = line.slice(split + 1).trim();
        frontmatter[key] =
            value === 'true' ? true : value === 'false' ? false : value;
    }
    return { frontmatter, body: raw.slice(end + 5) };
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
