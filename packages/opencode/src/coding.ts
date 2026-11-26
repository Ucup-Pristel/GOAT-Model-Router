import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, open, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { fileURLToPath } from "node:url"

const helper = fileURLToPath(new URL("./check-python.py", import.meta.url))
export function sandbox(input: unknown, signal?: AbortSignal, cwd = "/"): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFile("/usr/bin/python3", ["-ISB", helper], { env: {}, cwd, signal,
      timeout: 3000, killSignal: "SIGKILL", maxBuffer: 16384 }, (error, stdout) => {
      if (error) return reject(Error("Sandbox or Python check failed"))
      try { resolve(JSON.parse(stdout)) } catch { reject(Error("Invalid function output")) }
    })
    child.stdin?.on("error", () => {}) // An early exit is reported by execFile.
    child.stdin?.end(JSON.stringify(input))
  })
}

type Task = { instruction: string; filename: string; initialSource: string; function: string; cases: { args: unknown[]; expected: unknown }[] }
export async function loadTask(path: string): Promise<Task> {
  const raw = await readFile(path, "utf8")
  const t = JSON.parse(raw)
  if (raw.length > 32768 || !t || typeof t.instruction !== "string" || !t.instruction.trim() ||
    !/^[a-zA-Z][a-zA-Z0-9_]{0,63}\.py$/.test(t.filename) || typeof t.initialSource !== "string" ||
    !t.initialSource || Buffer.byteLength(t.initialSource) > 8192 || typeof t.function !== "string" ||
    !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(t.function) || !Array.isArray(t.cases) || !t.cases.length || t.cases.length > 12 ||
    !t.cases.every((c: Task["cases"][number]) => c && Array.isArray(c.args) && Object.hasOwn(c, "expected"))) throw Error("Invalid private task manifest")
  return t
}

export async function provision(task: Task, signal: AbortSignal) {
  if (process.platform !== "linux" || await sandbox("probe", signal) !== "isolated") throw Error("Python isolation unavailable")
  const directory = await mkdtemp(join(tmpdir(), "goat-worker-"))
  const path = join(directory, task.filename)
  // A new 0700 workspace and an exclusively-created 0600 inode. No tool
  // argument can open another path. Hold the capability until terminal.
  const fd = await open(path, "wx+", 0o600)
  async function replace(source: string) {
    const bytes = Buffer.from(source)
    if (!bytes.length || bytes.length > 8192) throw Error("Source exceeds task limit")
    if ((await fd.write(bytes, 0, bytes.length, 0)).bytesWritten !== bytes.length) throw Error("Short write")
    await fd.truncate(bytes.length)
  }
  async function read() {
    const bytes = Buffer.alloc(8193)
    const { bytesRead } = await fd.read(bytes, 0, bytes.length, 0)
    if (bytesRead === bytes.length) throw Error("Unexpected file size")
    return bytes.toString("utf8", 0, bytesRead)
  }
  async function inspect() {
    const source = await read()
    const results = []
    for (const c of task.cases) {
      signal.throwIfAborted()
      try {
        const actual = await sandbox({ source, function: task.function, args: c.args }, signal)
        results.push({ ...c, actual, passed: isDeepStrictEqual(actual, c.expected) })
      } catch { signal.throwIfAborted(); results.push({ ...c, passed: false, error: "function failed or sandbox limit" }) }
    }
    const hash = (s: string) => createHash("sha256").update(s).digest("hex")
    return { file: task.filename, before: task.initialSource, after: source, sha256: hash(source), results,
      passed: source !== task.initialSource && results.every(r => r.passed) }
  }
  try {
    await replace(task.initialSource)
    if ((await inspect()).results.every(r => r.passed)) throw Error("Baseline already passes")
    return { path, read, replace, inspect, close: () => fd.close() }
  } catch (e) { await fd.close(); throw e }
}
export type Workspace = Awaited<ReturnType<typeof provision>>
