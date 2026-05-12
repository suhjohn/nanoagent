export declare function serializeJsonLine(value: any): string;
export declare function attachJsonlLineReader(input: any, onCommand: any): () => void;
export declare function createRpcHandler(params: any): (command: any) => Promise<void>;
