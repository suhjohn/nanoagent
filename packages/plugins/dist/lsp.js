// Origin:
// - OpenCode: packages/opencode/src/tool/lsp.ts, lsp/lsp.ts, lsp/client.ts
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const LSP_OPERATIONS = [
    'goToDefinition',
    'findReferences',
    'hover',
    'documentSymbol',
    'workspaceSymbol',
    'goToImplementation',
    'prepareCallHierarchy',
    'incomingCalls',
    'outgoingCalls'
];
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
    const tool = lspTool({ toolName, cwd, client });
    const attachTool = options => ({
        ...options,
        tools: { ...(options.tools ?? {}), [toolName]: tool }
    });
    if (!ownsClient)
        return attachTool;
    return options => attachClientLifecycle(attachTool(options), client);
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
            if (!serverHandlesExtension(config, ext))
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
            onNotification: message => handlePublishDiagnostics({ runtime, message })
        });
        runtime.initialized = initializeRuntime(runtime).catch(error => {
            runtime.broken = error instanceof Error ? error : new Error(String(error));
            runtime.connection.close();
            throw runtime.broken;
        });
        return runtime;
    }
    async function initializeRuntime(runtime) {
        await runtime.connection.request('initialize', initializeParams(runtime));
        runtime.connection.notify('initialized', {});
    }
    return {
        hasClient: async (file) => (await matches(path.resolve(file))).length > 0,
        touchFile: async (file, diagnostics = 'none') => {
            const absolute = path.resolve(file);
            const text = await readFile(absolute, 'utf8');
            const uri = pathToFileURL(absolute).href;
            const targets = await getRuntimes(absolute);
            await Promise.all(targets.map(runtime => syncDocument({
                runtime,
                absolute,
                uri,
                text,
                diagnosticsMode: diagnostics,
                diagnosticsTimeoutMs
            })));
        },
        operation: async (args) => {
            const targets = await getRuntimes(path.resolve(args.file));
            const results = await Promise.all(targets.map(runtime => requestOperation({ runtime, args })));
            return results.flat();
        },
        diagnostics: async (file) => {
            const absolute = path.resolve(file);
            const uri = pathToFileURL(absolute).href;
            const targets = await getRuntimes(absolute);
            const diagnostics = await Promise.all(targets.map(runtime => collectDiagnostics({ runtime, uri })));
            return diagnostics.flat();
        },
        close: async () => {
            await Promise.all([...runtimes.values()].map(shutdownRuntime));
            runtimes.clear();
        }
    };
}
export async function diagnosticsAfterEdit(client, file) {
    await client.touchFile?.(file, 'document');
    return (await client.diagnostics?.(file)) ?? [];
}
function lspTool(params) {
    const { toolName, cwd, client } = params;
    return {
        description: 'Run LSP operation for definitions, references, hover, symbols, implementations, and call hierarchy.',
        inputSchema: objectSchema({
            operation: { type: 'string', enum: LSP_OPERATIONS },
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
            return {
                title: operationTitle({ operation, cwd, file, line, character }),
                result
            };
        }
    };
}
function operationTitle(args) {
    if (args.operation === 'workspaceSymbol')
        return args.operation;
    const rel = path.relative(args.cwd, args.file);
    if (args.operation === 'documentSymbol')
        return `${args.operation} ${rel}`;
    return `${args.operation} ${rel}:${args.line}:${args.character}`;
}
function attachClientLifecycle(options, client) {
    const closeClient = async () => {
        await client.close?.();
    };
    return {
        ...options,
        hooks: {
            ...options.hooks,
            onRunCompleted: async (args) => {
                try {
                    return (await options.hooks.onRunCompleted?.(args));
                }
                finally {
                    await closeClient();
                }
            },
            onRunFailed: async (args) => {
                try {
                    return (await options.hooks.onRunFailed?.(args));
                }
                finally {
                    await closeClient();
                }
            }
        }
    };
}
function serverHandlesExtension(config, ext) {
    if (!config.extensions?.length)
        return true;
    return config.extensions.map(normalizeExtension).includes(ext);
}
function initializeParams(runtime) {
    const rootUri = pathToFileURL(runtime.root).href;
    return {
        processId: process.pid,
        clientInfo: { name: 'nanoagent-lsp' },
        rootPath: runtime.root,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: path.basename(runtime.root) }],
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
    };
}
function handlePublishDiagnostics(args) {
    if (args.message.method !== 'textDocument/publishDiagnostics')
        return;
    const params = args.message.params;
    if (typeof params?.uri !== 'string')
        return;
    args.runtime.diagnostics.set(params.uri, Array.isArray(params.diagnostics) ? params.diagnostics : []);
    const waiters = args.runtime.diagnosticWaiters.get(params.uri) ?? [];
    args.runtime.diagnosticWaiters.delete(params.uri);
    for (const resolve of waiters)
        resolve();
}
async function syncDocument(args) {
    const { runtime, absolute, uri, text } = args;
    const version = (runtime.versions.get(uri) ?? 0) + 1;
    runtime.versions.set(uri, version);
    const waiter = args.diagnosticsMode === 'document'
        ? waitForDiagnostics({
            runtime,
            uri,
            timeoutMs: args.diagnosticsTimeoutMs
        })
        : Promise.resolve();
    if (version === 1) {
        runtime.connection.notify('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId: languageIdFor({ file: absolute, config: runtime.config }),
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
}
async function collectDiagnostics(args) {
    if (!args.runtime.diagnostics.has(args.uri)) {
        await requestPullDiagnostics(args).catch(() => undefined);
    }
    return args.runtime.diagnostics.get(args.uri) ?? [];
}
async function shutdownRuntime(runtime) {
    await runtime.connection.request('shutdown', null).catch(() => undefined);
    runtime.connection.notify('exit', undefined);
    runtime.connection.close();
}
async function requestOperation(args) {
    const { runtime } = args;
    const op = args.args.operation;
    const textDocument = { uri: args.args.uri };
    const position = { line: args.args.line, character: args.args.character };
    const positionParams = { textDocument, position };
    switch (op) {
        case 'goToDefinition':
            return requestArray(runtime, 'textDocument/definition', positionParams);
        case 'findReferences':
            return requestArray(runtime, 'textDocument/references', {
                ...positionParams,
                context: { includeDeclaration: true }
            });
        case 'hover':
            return requestArray(runtime, 'textDocument/hover', positionParams);
        case 'documentSymbol':
            return requestArray(runtime, 'textDocument/documentSymbol', {
                textDocument
            });
        case 'workspaceSymbol':
            return requestArray(runtime, 'workspace/symbol', {
                query: args.args.query ?? ''
            });
        case 'goToImplementation':
            return requestArray(runtime, 'textDocument/implementation', positionParams);
        case 'prepareCallHierarchy':
            return requestArray(runtime, 'textDocument/prepareCallHierarchy', positionParams);
        case 'incomingCalls':
            return callHierarchyCalls(runtime, positionParams, 'incomingCalls');
        case 'outgoingCalls':
            return callHierarchyCalls(runtime, positionParams, 'outgoingCalls');
    }
}
async function requestArray(runtime, method, params) {
    return toArray(await runtime.connection.request(method, params));
}
async function callHierarchyCalls(runtime, positionParams, direction) {
    const items = await requestArray(runtime, 'textDocument/prepareCallHierarchy', positionParams);
    const method = `callHierarchy/${direction}`;
    const calls = await Promise.all(items.map(item => runtime.connection.request(method, { item })));
    return calls.flatMap(toArray);
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
    if (args.config.languageId)
        return args.config.languageId;
    const ext = path.extname(args.file).toLowerCase();
    const mapped = languageByExtension.get(ext);
    if (mapped)
        return mapped;
    return ext.slice(1) || 'plaintext';
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
    return LSP_OPERATIONS.includes(value);
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
        const hasId = message.id !== undefined && message.id !== null;
        if (hasId && message.method) {
            this.respond(message.id, this.requestResult(message));
            return;
        }
        if (hasId) {
            this.resolvePending(message);
            return;
        }
        this.params.onNotification(message);
    }
    resolvePending(message) {
        const id = message.id;
        const pending = this.pending.get(id);
        if (!pending)
            return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        if (message.error) {
            pending.reject(new Error(message.error.message));
        }
        else {
            pending.resolve(message.result);
        }
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
