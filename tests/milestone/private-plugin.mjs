import { cp, mkdir, open, realpath, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { constants } from "node:fs"
import { sign, verify } from "node:crypto"

export function checkVersion(actual, expected) {
  if (!["2.3.2", "2.4.1", "2.4.2"].some(v => actual === `opencode v${v}`)) throw Error(`Unsupported OpenCode: ${actual}`)
  if (expected && actual !== `opencode v${expected}`) throw Error(`Expected OpenCode ${expected}, got ${actual}`)
}

export const deny = [{ action: "*", resource: "*", effect: "deny" }]
export const codingAgents = { build: { steps: 5, permissions: [...deny, { action: "goat_verify_text", resource: "*", effect: "allow" }] },
  "goat-code-worker": { steps: 5, permissions: deny }, "goat-local-text": { steps: 1, permissions: deny } }
export const projectAgents = { ...codingAgents, "goat-code-worker": { steps: 24, permissions: deny },
  "goat-project-auditor": { steps: 6, permissions: deny } }

export async function signProject(env, options, privateKey, publicKey) {
  const root = await realpath(options.project)
  const files = []
  for (const role of ["edit", "read", "test"]) {
    for (const path of options[role] ?? []) {
      if (files.length >= 20 || !/^(?:[A-Za-z0-9_-]+\/){0,5}[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(path) ||
        files.some(f => f.path === path)) throw Error("Invalid or duplicate project path")
      let source = null
      const parents = []
      try {
        // openat-equivalent descent on Linux: a renamed intermediate directory
        // cannot redirect the next open into another project.
        const parts = path.split("/")
        let dir = root
        for (const segment of ["", ...parts.slice(0,-1)]) {
          const parent = await open(join(dir, segment), constants.O_DIRECTORY | constants.O_NOFOLLOW)
          parents.push(parent)
          dir = `/proc/self/fd/${parent.fd}`
        }
        const fd = await open(join(dir, parts.at(-1)), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
        try {
          const st = await fd.stat()
          if (!st.isFile() || st.nlink !== 1 || st.size > 16384) throw Error("Expected small regular source file")
          const data = Buffer.alloc(16385)
          const { bytesRead } = await fd.read(data, 0, data.length, 0)
          if (bytesRead !== st.size) throw Error("Project input changed during snapshot")
          source = new TextDecoder("utf8", { fatal: true }).decode(data.subarray(0, bytesRead))
        } finally { await fd.close() }
      } catch (e) { if (e.code !== "ENOENT" || role !== "edit") throw e }
      finally { await Promise.all(parents.map(fd => fd.close())) }
      files.push({ path, role, source })
    }
  }
  if (!options.instruction?.trim() || !files.some(f => f.role === "edit") || !files.some(f => f.role === "test")) {
    throw Error("Project launch needs --instruction, --edit and --test")
  }
  const payload = JSON.stringify({ location: env.GOAT_TEXT_PROJECT, instruction: options.instruction,
    expires: Date.now() + 3600000, files, userPlan: options.step, schedule: options.schedule })
  const signature = sign(null, Buffer.from(payload), privateKey)
  if (!verify(null, Buffer.from(payload), publicKey, signature)) throw Error("Owner key mismatch")
  await writeFile(env.GOAT_CODE_MANIFEST, JSON.stringify({ payload, signature: signature.toString("base64") }), { flag: "wx", mode: 0o600 })
  env.GOAT_LIVE_PROFILE = "project"
  env.GOAT_OWNER_PUBLIC_KEY = publicKey
}

export async function installPrivatePlugin(project) {
  for (const name of ["core", "opencode"]) {
    const dest = name === "opencode" ? join(project, ".opencode/plugins/goat") : join(project, "node_modules/@goat/core")
    const src = new URL(`../../packages/${name}/`, import.meta.url)
    await mkdir(dest, { recursive: true })
    await cp(new URL("package.json", src), join(dest, "package.json"))
    await cp(new URL("dist", src), join(dest, "dist"), { recursive: true })
  }
}
