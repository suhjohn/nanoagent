// @ts-nocheck
// Origin:
// - Pi: packages/coding-agent/src/modes/rpc/rpc-mode.ts, rpc-types.ts, jsonl.ts
// Behavior: strict JSONL command/response adapter for headless runtime hosts.
import { createInterface } from 'node:readline';
export function serializeJsonLine(value) {
    return `${JSON.stringify(value)}\n`;
}
export function attachJsonlLineReader(input, onCommand) {
    const rl = createInterface({ input });
    rl.on('line', line => {
        if (!line.trim())
            return;
        onCommand(JSON.parse(line));
    });
    return () => rl.close();
}
export function createRpcHandler(params) {
    return async (command) => {
        try {
            const data = await params.handle(command);
            params.output.write(serializeJsonLine({
                id: command.id,
                type: 'response',
                command: command.type,
                success: true,
                data
            }));
        }
        catch (error) {
            params.output.write(serializeJsonLine({
                id: command.id,
                type: 'response',
                command: command.type,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            }));
        }
    };
}
