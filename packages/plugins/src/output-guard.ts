type WriteCallback = (error?: Error | null) => void

type Write = (chunk: string, callback?: WriteCallback) => boolean

type StdoutState = {
  rawStdoutWrite: Write
  rawStderrWrite: Write
  originalStdoutWrite: typeof process.stdout.write
}

let state: StdoutState | undefined

export function takeOverStdout() {
  if (state) return
  const rawStdoutWrite = process.stdout.write.bind(process.stdout) as Write
  const rawStderrWrite = process.stderr.write.bind(process.stderr) as Write
  const originalStdoutWrite = process.stdout.write

  process.stdout.write = redirectToStderr(rawStderrWrite)
  state = { rawStdoutWrite, rawStderrWrite, originalStdoutWrite }
}

export function restoreStdout() {
  if (!state) return
  process.stdout.write = state.originalStdoutWrite
  state = undefined
}

export function isStdoutTakenOver() {
  return state !== undefined
}

export function writeRawStdout(text: string) {
  if (state) {
    state.rawStdoutWrite(text)
    return
  }
  process.stdout.write(text)
}

export async function flushRawStdout() {
  const write =
    state?.rawStdoutWrite ?? process.stdout.write.bind(process.stdout)
  await new Promise<void>((resolve, reject) => {
    write('', error => (error ? reject(error) : resolve()))
  })
}

function redirectToStderr(
  stderrWrite: Write
): typeof process.stdout.write {
  return ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | WriteCallback,
    callback?: WriteCallback
  ) => {
    const done =
      typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
    return stderrWrite(String(chunk), done)
  }) as typeof process.stdout.write
}
