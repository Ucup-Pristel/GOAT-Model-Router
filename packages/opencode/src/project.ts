import { createHash, createPublicKey, verify } from "node:crypto"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { sandbox } from "./coding.js"

export type ProjectTask = {
  instruction: string; location: string; expires: number; userPlan?: string[]
  files: { path: string; source: string | null; role: "edit" | "read" | "test" }[]
}
export const digest = (text: string) => createHash("sha256").update(text).digest("hex")
// Refusals made by the broker without reading or modifying file contents.
export class ProjectFileRefusal extends Error {}

// The public key is provisioned by the launcher, never accepted from RPC,
// OpenCode storage, a session approval or the signed envelope itself.
export async function authorizedProject(path: string, location: string, instruction: string) {
  const { payload, signature } = JSON.parse(await readFile(path, "utf8"))
  const key = createPublicKey(process.env.GOAT_OWNER_PUBLIC_KEY ?? "")
  if (key.asymmetricKeyType !== "ed25519" || typeof payload !== "string" || payload.length > 131072 ||
      !verify(null, Buffer.from(payload), key, Buffer.from(signature, "base64"))) throw Error("Invalid owner signature")
  const task: ProjectTask = JSON.parse(payload)
  if (task.location !== location || task.instruction !== instruction || instruction.length > 2048 || !Number.isSafeInteger(task.expires) ||
    task.userPlan !== undefined && (!Array.isArray(task.userPlan) || task.userPlan.length > 4 || task.userPlan.some(s => typeof s !== "string" || !s.trim() || s.length > 512)) ||
    Date.now() >= task.expires || !Array.isArray(task.files) || task.files.length > 20 ||
    !task.files.some(f => f.role === "edit") || !task.files.some(f => f.role === "test") ||
    task.files.some(f => !/^(?:[A-Za-z0-9_-]+\/){0,5}[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(f.path) ||
      f.path.length > 128 || !["edit", "read", "test"].includes(f.role) ||
      (f.source === null ? f.role !== "edit" : typeof f.source !== "string" || Buffer.byteLength(f.source) > 16384) ||
      f.role === "test" && !/^(?:[A-Za-z_]\w*\/)*[A-Za-z_]\w*\.py$/.test(f.path)) ||
    new Set(task.files.map(f => f.path)).size !== task.files.length) throw Error("Outside owner authorization")
  return task
}

export async function provisionProject(task: ProjectTask, signal: AbortSignal) {
  const path = await mkdtemp(join(tmpdir(), "goat-worker-"))
  if (await sandbox({ suite: null }, signal, path) !== "isolated") throw Error("Project isolation unavailable")
  const files = new Map(task.files.map(f => [f.path, f]))
  const notYetCreated = new Set(task.files.filter(f => f.source === null).map(f => f.path))
  for (const file of files.values()) {
    await mkdir(dirname(join(path, file.path)), { recursive: true, mode: 0o700 })
    if (file.source !== null) await writeFile(join(path, file.path), file.source, { flag: "wx", mode: 0o600 })
  }
  async function read(name?: string) {
    if (!name || !files.has(name)) throw Error("Outside assigned files")
    try { return await readFile(join(path, name), "utf8") }
    catch (e) {
      if (notYetCreated.has(name) && (e as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ProjectFileRefusal("Assigned new file does not exist yet")
      }
      throw e
    }
  }
  async function replace(source: string, name?: string) {
    if (!name || !files.has(name) || Buffer.byteLength(source) > 16384) throw Error("Outside assigned writes")
    if (files.get(name)!.role !== "edit") throw new ProjectFileRefusal("Assigned file is read-only")
    // Only the broker can write this fresh tree. Test processes see it read-only.
    await writeFile(join(path, name), source, { mode: 0o600 })
    notYetCreated.delete(name)
  }
  async function inspect() {
    const results = []
    for (const file of files.values()) {
      if (file.role !== "test") continue
      const suite = file.path.slice(0, -3).replaceAll("/", ".")
      signal.throwIfAborted()
      let count = 0, passed = false, failures: string[] = []
      try {
        const r = await sandbox({ suite }, signal, path) as { count: number; passed: boolean; failures: string[] }
        if (!Number.isSafeInteger(r.count) || r.count < 1 || !Array.isArray(r.failures) ||
          !r.failures.every(x => typeof x === "string")) throw Error("Invalid suite result")
        count = r.count; passed = r.passed === true && !r.failures.length; failures = r.failures
      } catch { signal.throwIfAborted(); failures = ["test process failed or exceeded its limit"] }
      results.push({ suite, count, passed, failures })
    }
    const changes = []
    for (const f of files.values()) {
      let after: string | null
      try { after = await read(f.path) }
      catch (e) { if (f.source !== null || !(e instanceof ProjectFileRefusal)) throw e; after = null }
      if (after !== f.source) changes.push({ path: f.path, before: f.source, after, sha256: digest(after!) })
    }
    return { changes, results, sha256: digest(JSON.stringify(changes)), passed: changes.length > 0 && results.every(r => r.passed) }
  }
  const baseline = (await inspect()).results
  return { path, read, replace, inspect: async () => ({ ...await inspect(), baseline }), close: async () => {} }
}
