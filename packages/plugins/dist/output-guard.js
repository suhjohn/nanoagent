let state;
export function takeOverStdout() {
    if (state)
        return;
    const rawStdoutWrite = process.stdout.write.bind(process.stdout);
    const rawStderrWrite = process.stderr.write.bind(process.stderr);
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = ((chunk, encodingOrCallback, callback) => {
        const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
        return rawStderrWrite(String(chunk), done);
    });
    state = { rawStdoutWrite, rawStderrWrite, originalStdoutWrite };
}
export function restoreStdout() {
    if (!state)
        return;
    process.stdout.write = state.originalStdoutWrite;
    state = undefined;
}
export function isStdoutTakenOver() {
    return state !== undefined;
}
export function writeRawStdout(text) {
    if (state) {
        state.rawStdoutWrite(text);
        return;
    }
    process.stdout.write(text);
}
export async function flushRawStdout() {
    await new Promise((resolve, reject) => {
        const write = state?.rawStdoutWrite ?? process.stdout.write.bind(process.stdout);
        write('', error => (error ? reject(error) : resolve()));
    });
}
