import type { Readable, Writable } from 'node:stream';
type Awaitable<A> = A | Promise<A>;
export type JsonlRpcCommand = {
    id?: string | number;
    type: string;
    [key: string]: unknown;
};
export type JsonlRpcResponse = {
    id?: string | number;
    type: 'response';
    command: string;
    success: true;
    data: unknown;
} | {
    id?: string | number;
    type: 'response';
    command: string;
    success: false;
    error: string;
};
export type JsonlRpcHandlerParams = {
    handle: (command: JsonlRpcCommand) => Awaitable<unknown>;
    output: Pick<Writable, 'write'>;
};
export declare function serializeJsonLine(value: unknown): string;
export declare function attachJsonlLineReader(input: Readable, onCommand: (command: JsonlRpcCommand) => void, onError?: (error: Error) => void): () => void;
export declare function createRpcHandler(params: JsonlRpcHandlerParams): (command: JsonlRpcCommand) => Promise<void>;
export {};
