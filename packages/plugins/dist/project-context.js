import { readFile } from 'node:fs/promises';
import path from 'node:path';
const CONTEXT_FILES = ['AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD'];
export function withProjectContext(params) {
    const cwd = path.resolve(params.cwd);
    const agentDir = params.agentDir && path.resolve(params.agentDir);
    let cached;
    return options => ({
        ...options,
        hooks: {
            ...options.hooks,
            onTurnPrepared: async (args) => {
                const previous = (await options.hooks.onTurnPrepared(args));
                if (!previous?.value || previous.control)
                    return previous;
                cached ??= (async () => {
                    const dirs = [];
                    if (agentDir)
                        dirs.push(agentDir);
                    for (let current = cwd;; current = path.dirname(current)) {
                        dirs.push(current);
                        if (current === path.dirname(current))
                            break;
                    }
                    const sections = [];
                    const seen = new Set();
                    for (const dir of dirs) {
                        for (const name of CONTEXT_FILES) {
                            const file = path.join(dir, name);
                            if (seen.has(file))
                                continue;
                            seen.add(file);
                            const content = await readFile(file, 'utf8').catch(error => {
                                if (error instanceof Error &&
                                    'code' in error &&
                                    error.code === 'ENOENT') {
                                    return undefined;
                                }
                                throw error;
                            });
                            if (content) {
                                sections.push(`<project_context path="${file}">\n${content}\n</project_context>`);
                            }
                        }
                    }
                    return sections;
                })();
                const sections = await cached;
                if (!sections.length)
                    return previous;
                const content = sections.join('\n\n');
                const projectContext = { role: 'system', content };
                return {
                    context: previous.context,
                    value: {
                        ...previous.value,
                        system: previous.value.system
                            ? typeof previous.value.system === 'string'
                                ? `${content}\n\n${previous.value.system}`
                                : [
                                    projectContext,
                                    ...(Array.isArray(previous.value.system)
                                        ? previous.value.system
                                        : [previous.value.system])
                                ]
                            : projectContext
                    }
                };
            }
        }
    });
}
