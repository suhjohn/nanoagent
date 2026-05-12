// Origin:
// - OpenCode: packages/opencode/src/tool/lsp.ts, lsp/lsp.ts, lsp/client.ts
// Behavior: LSP server lifecycle, document sync, navigation/search operations, and diagnostics after edits.
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export function withLspTool(params) {
    const toolName = params.toolName ?? 'lsp';
    const cwd = path.resolve(params.cwd);
    const ownsClient = !params.client;
    const client = params.client ??
        createNodeLspClient({
            cwd,
            servers: params.servers ?? [],
            requestTimeoutMs: params.requestTimeoutMs,
            diagnosticsTimeoutMs: params.diagnosticsTimeoutMs
        });
    const tool = {
        description: 'Run LSP operation for definitions, references, hover, symbols, implementations, and call hierarchy.',
        inputSchema: objectSchema({
            operation: {
                type: 'string',
                enum: [
                    'goToDefinition',
                    'findReferences',
                    'hover',
                    'documentSymbol',
                    'workspaceSymbol',
                    'goToImplementation',
                    'prepareCallHierarchy',
                    'incomingCalls',
                    'outgoingCalls'
                ]
            },
            filePath: { type: 'string' },
            line: { type: 'integer', minimum: 1 },
            character: { type: 'integer', minimum: 1 },
            query: { type: 'string' }
        }, ['operation', 'filePath', 'line', 'character']),
        execute: async (input) => {
            const record = assertRecord(input, toolName);
            const operation = stringField(record, 'operation');
            if (!isLspOperation(operation))
                throw new Error(`Invalid LSP operation "${operation}".`);
            const file = await assertWorkspaceFile({
                cwd,
                filePath: stringField(record, 'filePath')
            });
            if (!(await client.hasClient(file))) {
                throw new Error('No LSP server available for this file type.');
            }
            await client.touchFile?.(file, 'none');
            const line = numberField(record, 'line', 1);
            const character = numberField(record, 'character', 1);
            const result = await client.operation({
                operation,
                file,
                uri: pathToFileURL(file).href,
                line: line - 1,
                character: character - 1,
                query: stringField(record, 'query', false)
            });
            const rel = path.relative(cwd, file);
            const title = operation === 'workspaceSymbol'
                ? operation
                : operation === 'documentSymbol'
                    ? `${operation} ${rel}`
                    : `${operation} ${rel}:${line}:${character}`;
            return { title, result };
        }
    };
    const plugin = options => ({
        ...options,
        tools: { ...(options.tools ?? {}), [toolName]: tool }
    });
    if (!ownsClient)
        return plugin;
    return options => {
        const configured = plugin(options);
        return {
            ...configured,
            hooks: {
                ...configured.hooks,
                onRunCompleted: async (args) => {
                    try {
                        return (await configured.hooks.onRunCompleted?.(args));
                    }
                    finally {
                        await client.close?.();
                    }
                },
                onRunFailed: async (args) => {
                    try {
                        return (await configured.hooks.onRunFailed?.(args));
                    }
                    finally {
                        await client.close?.();
                    }
                }
            }
        };
    };
}
export function createNodeLspClient(params) {
    const cwd = path.resolve(params.cwd);
    const requestTimeoutMs = params.requestTimeoutMs ?? 15_000;
    const diagnosticsTimeoutMs = params.diagnosticsTimeoutMs ?? 1_500;
    const runtimes = new Map();
    async function matches(file) {
        if (!isInside(cwd, file))
            return [];
        const ext = path.extname(file).toLowerCase();
        const result = [];
        for (const config of params.servers) {
            const extensions = config.extensions?.map(normalizeExtension);
            if (extensions?.length && !extensions.includes(ext))
                continue;
            result.push({ config, root: await workspaceRoot({ cwd, file, config }) });
        }
        return result;
    }
    async function getRuntimes(file) {
        const matched = await matches(file);
        const result = [];
        for (const { config, root } of matched) {
            const key = `${config.id}:${root}`;
            const runtime = runtimes.get(key) ?? startRuntime({ key, config, root });
            runtimes.set(key, runtime);
            await runtime.initialized;
            if (!runtime.broken)
                result.push(runtime);
        }
        return result;
    }
    function startRuntime(args) {
        const [command, ...commandArgs] = args.config.command;
        if (!command)
            throw new Error(`LSP server "${args.config.id}" has no command.`);
        const child = spawn(command, commandArgs, {
            cwd: args.root,
            env: { ...process.env, ...params.env, ...args.config.env },
            stdio: 'pipe'
        });
        const runtime = {
            ...args,
            connection: undefined,
            initialized: undefined,
            diagnostics: new Map(),
            diagnosticWaiters: new Map(),
            versions: new Map()
        };
        runtime.connection = new LspConnection({
            process: child,
            root: args.root,
            settings: args.config.settings,
            timeoutMs: requestTimeoutMs,
            onNotification: message => {
                if (message.method !== 'textDocument/publishDiagnostics')
                    return;
                const params = message.params;
                if (typeof params?.uri !== 'string')
                    return;
                runtime.diagnostics.set(params.uri, Array.isArray(params.diagnostics) ? params.diagnostics : []);
                const waiters = runtime.diagnosticWaiters.get(params.uri) ?? [];
                runtime.diagnosticWaiters.delete(params.uri);
                for (const resolve of waiters)
                    resolve();
            }
        });
        runtime.initialized = initializeRuntime(runtime).catch(error => {
            runtime.broken = error instanceof Error ? error : new Error(String(error));
            runtime.connection.close();
            throw runtime.broken;
        });
        return runtime;
    }
    async function initializeRuntime(runtime) {
        await runtime.connection.request('initialize', {
            processId: process.pid,
            clientInfo: { name: 'nanoagent-lsp' },
            rootPath: runtime.root,
            rootUri: pathToFileURL(runtime.root).href,
            workspaceFolders: [
                {
                    uri: pathToFileURL(runtime.root).href,
                    name: path.basename(runtime.root)
                }
            ],
            initializationOptions: runtime.config.initializationOptions,
            capabilities: {
                textDocument: {
                    synchronization: { didSave: true },
                    definition: {},
                    references: {},
                    hover: {},
                    documentSymbol: {},
                    implementation: {},
                    callHierarchy: {},
                    publishDiagnostics: { relatedInformation: true }
                },
                workspace: {
                    symbol: {},
                    workspaceFolders: true,
                    configuration: true,
                    didChangeConfiguration: {}
                },
                window: { workDoneProgress: true }
            }
        });
        runtime.connection.notify('initialized', {});
    }
    return {
        hasClient: async (file) => (await matches(path.resolve(file))).length > 0,
        touchFile: async (file, diagnostics = 'none') => {
            const absolute = path.resolve(file);
            const text = await readFile(absolute, 'utf8');
            const uri = pathToFileURL(absolute).href;
            await Promise.all((await getRuntimes(absolute)).map(async (runtime) => {
                const version = (runtime.versions.get(uri) ?? 0) + 1;
                runtime.versions.set(uri, version);
                const waiter = diagnostics === 'document'
                    ? waitForDiagnostics({
                        runtime,
                        uri,
                        timeoutMs: diagnosticsTimeoutMs
                    })
                    : Promise.resolve();
                if (version === 1) {
                    runtime.connection.notify('textDocument/didOpen', {
                        textDocument: {
                            uri,
                            languageId: languageIdFor({
                                file: absolute,
                                config: runtime.config
                            }),
                            version,
                            text
                        }
                    });
                }
                else {
                    runtime.connection.notify('textDocument/didChange', {
                        textDocument: { uri, version },
                        contentChanges: [{ text }]
                    });
                }
                await waiter;
            }));
        },
        operation: async (args) => {
            const runtimes = await getRuntimes(path.resolve(args.file));
            const results = await Promise.all(runtimes.map(runtime => requestOperation({ runtime, args })));
            return results.flat();
        },
        diagnostics: async (file) => {
            const absolute = path.resolve(file);
            const uri = pathToFileURL(absolute).href;
            const diagnostics = await Promise.all((await getRuntimes(absolute)).map(async (runtime) => {
                if (!runtime.diagnostics.has(uri)) {
                    await requestPullDiagnostics({ runtime, uri }).catch(() => undefined);
                }
                return runtime.diagnostics.get(uri) ?? [];
            }));
            return diagnostics.flat();
        },
        close: async () => {
            await Promise.all([...runtimes.values()].map(async (runtime) => {
                await runtime.connection
                    .request('shutdown', null)
                    .catch(() => undefined);
                runtime.connection.notify('exit', undefined);
                runtime.connection.close();
            }));
            runtimes.clear();
        }
    };
}
export async function diagnosticsAfterEdit(client, file) {
    await client.touchFile?.(file, 'document');
    return (await client.diagnostics?.(file)) ?? [];
}
async function requestOperation(args) {
    const textDocument = { uri: args.args.uri };
    const position = { line: args.args.line, character: args.args.character };
    const positionParams = { textDocument, position };
    switch (args.args.operation) {
        case 'goToDefinition':
            return toArray(await args.runtime.connection.request('textDocument/definition', positionParams));
        case 'findReferences':
            return toArray(await args.runtime.connection.request('textDocument/references', {
                ...positionParams,
                context: { includeDeclaration: true }
            }));
        case 'hover':
            return toArray(await args.runtime.connection.request('textDocument/hover', positionParams));
        case 'documentSymbol':
            return toArray(await args.runtime.connection.request('textDocument/documentSymbol', {
                textDocument
            }));
        case 'workspaceSymbol':
            return toArray(await args.runtime.connection.request('workspace/symbol', {
                query: args.args.query ?? ''
            }));
        case 'goToImplementation':
            return toArray(await args.runtime.connection.request('textDocument/implementation', positionParams));
        case 'prepareCallHierarchy':
            return toArray(await args.runtime.connection.request('textDocument/prepareCallHierarchy', positionParams));
        case 'incomingCalls': {
            const items = toArray(await args.runtime.connection.request('textDocument/prepareCallHierarchy', positionParams));
            const calls = await Promise.all(items.map(item => args.runtime.connection.request('callHierarchy/incomingCalls', {
                item
            })));
            return calls.flatMap(toArray);
        }
        case 'outgoingCalls': {
            const items = toArray(await args.runtime.connection.request('textDocument/prepareCallHierarchy', positionParams));
            const calls = await Promise.all(items.map(item => args.runtime.connection.request('callHierarchy/outgoingCalls', {
                item
            })));
            return calls.flatMap(toArray);
        }
    }
}
async function requestPullDiagnostics(args) {
    const result = (await args.runtime.connection.request('textDocument/diagnostic', {
        textDocument: { uri: args.uri }
    }));
    if (Array.isArray(result?.items)) {
        args.runtime.diagnostics.set(args.uri, result.items);
    }
}
function waitForDiagnostics(args) {
    return new Promise(resolve => {
        const waiters = args.runtime.diagnosticWaiters.get(args.uri) ?? [];
        waiters.push(resolve);
        args.runtime.diagnosticWaiters.set(args.uri, waiters);
        setTimeout(resolve, args.timeoutMs).unref();
    });
}
async function assertWorkspaceFile(args) {
    const file = path.resolve(args.cwd, args.filePath);
    if (!isInside(args.cwd, file))
        throw new Error('LSP file is outside workspace.');
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile())
        throw new Error(`LSP file does not exist: ${args.filePath}`);
    return file;
}
async function workspaceRoot(args) {
    const markers = args.config.rootMarkers ?? [];
    if (!markers.length)
        return args.cwd;
    for (let dir = path.dirname(args.file); isInside(args.cwd, dir); dir = path.dirname(dir)) {
        for (const marker of markers) {
            if (await exists(path.join(dir, marker)))
                return dir;
        }
        if (dir === args.cwd)
            break;
    }
    return args.cwd;
}
async function exists(file) {
    return stat(file)
        .then(() => true)
        .catch(() => false);
}
function normalizeExtension(extension) {
    return extension.startsWith('.')
        ? extension.toLowerCase()
        : `.${extension.toLowerCase()}`;
}
function languageIdFor(args) {
    const extensionId = path.extname(args.file).slice(1);
    return (args.config.languageId ??
        languageByExtension.get(path.extname(args.file).toLowerCase()) ??
        (extensionId || 'plaintext'));
}
function toArray(value) {
    if (value === undefined || value === null)
        return [];
    return Array.isArray(value) ? value : [value];
}
function isInside(root, file) {
    const relative = path.relative(root, file);
    return (relative === '' ||
        (!relative.startsWith('..') && !path.isAbsolute(relative)));
}
function isLspOperation(value) {
    return [
        'goToDefinition',
        'findReferences',
        'hover',
        'documentSymbol',
        'workspaceSymbol',
        'goToImplementation',
        'prepareCallHierarchy',
        'incomingCalls',
        'outgoingCalls'
    ].includes(value);
}
class LspConnection {
    params;
    buffer = Buffer.alloc(0);
    closed = false;
    nextId = 1;
    pending = new Map();
    constructor(params) {
        this.params = params;
        params.process.stdout.on('data', chunk => this.read(chunk));
        params.process.stderr.on('data', () => undefined);
        params.process.on('error', error => this.fail(error));
        params.process.on('close', code => {
            this.fail(new Error(`LSP server exited with code ${code ?? 'unknown'}.`));
        });
    }
    request(method, params) {
        if (this.closed)
            throw new Error('LSP connection is closed.');
        const id = this.nextId++;
        this.write({ jsonrpc: '2.0', id, method, params });
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`LSP request timed out: ${method}`));
            }, this.params.timeoutMs);
            timer.unref();
            this.pending.set(id, { resolve, reject, timer });
        });
    }
    notify(method, params) {
        if (!this.closed)
            this.write({ jsonrpc: '2.0', method, params });
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        this.params.process.kill();
    }
    read(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (true) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1)
                return;
            const header = this.buffer.subarray(0, headerEnd).toString('utf8');
            const length = contentLength(header);
            if (length === undefined) {
                this.buffer = this.buffer.subarray(headerEnd + 4);
                continue;
            }
            const bodyStart = headerEnd + 4;
            const bodyEnd = bodyStart + length;
            if (this.buffer.length < bodyEnd)
                return;
            const body = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8');
            this.buffer = this.buffer.subarray(bodyEnd);
            this.handle(JSON.parse(body));
        }
    }
    handle(message) {
        if (message.id !== undefined && message.id !== null && message.method) {
            this.respond(message.id, this.requestResult(message));
            return;
        }
        if (message.id !== undefined && message.id !== null) {
            const pending = this.pending.get(message.id);
            if (!pending)
                return;
            this.pending.delete(message.id);
            clearTimeout(pending.timer);
            if (message.error) {
                pending.reject(new Error(message.error.message));
            }
            else {
                pending.resolve(message.result);
            }
            return;
        }
        this.params.onNotification(message);
    }
    requestResult(message) {
        if (message.method === 'workspace/workspaceFolders') {
            return [
                {
                    uri: pathToFileURL(this.params.root).href,
                    name: path.basename(this.params.root)
                }
            ];
        }
        if (message.method === 'workspace/configuration') {
            const params = message.params;
            return (params?.items ?? [undefined]).map(() => this.params.settings ?? null);
        }
        return null;
    }
    respond(id, result) {
        this.write({ jsonrpc: '2.0', id, result });
    }
    write(message) {
        const body = JSON.stringify(message);
        this.params.process.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
    }
    fail(error) {
        if (this.closed && !this.pending.size)
            return;
        this.closed = true;
        for (const [id, pending] of this.pending) {
            this.pending.delete(id);
            clearTimeout(pending.timer);
            pending.reject(error);
        }
    }
}
function contentLength(header) {
    const line = header
        .split('\r\n')
        .find(item => item.toLowerCase().startsWith('content-length:'));
    const value = Number(line?.slice(line.indexOf(':') + 1).trim());
    return Number.isFinite(value) ? value : undefined;
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
function numberField(input, key, fallback) {
    const value = input[key];
    if (value === undefined)
        return fallback;
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    throw new Error(`${key} must be a number.`);
}
const languageByExtension = new Map([
    ['.c', 'c'],
    ['.cc', 'cpp'],
    ['.cpp', 'cpp'],
    ['.cs', 'csharp'],
    ['.css', 'css'],
    ['.go', 'go'],
    ['.html', 'html'],
    ['.java', 'java'],
    ['.js', 'javascript'],
    ['.jsx', 'javascriptreact'],
    ['.json', 'json'],
    ['.kt', 'kotlin'],
    ['.lua', 'lua'],
    ['.md', 'markdown'],
    ['.php', 'php'],
    ['.py', 'python'],
    ['.rb', 'ruby'],
    ['.rs', 'rust'],
    ['.sh', 'shellscript'],
    ['.ts', 'typescript'],
    ['.tsx', 'typescriptreact'],
    ['.vue', 'vue'],
    ['.yaml', 'yaml'],
    ['.yml', 'yaml']
]);
