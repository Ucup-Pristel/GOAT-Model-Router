import { cp, mkdir } from "node:fs/promises"
import { join } from "node:path"

export function checkVersion(actual, expected) {
  if (!["2.3.2", "2.4.1", "2.4.2"].some(v => actual === `opencode v${v}`)) throw Error(`Unsupported OpenCode: ${actual}`)
  if (expected && actual !== `opencode v${expected}`) throw Error(`Expected OpenCode ${expected}, got ${actual}`)
}

export const deny = [{ action: "*", resource: "*", effect: "deny" }]
export const codingAgents = { build: { steps: 2, permissions: [...deny, { action: "goat_verify_text", resource: "*", effect: "allow" }] },
  "goat-code-worker": { steps: 3, permissions: deny }, "goat-local-text": { steps: 1, permissions: deny } }

export async function installPrivatePlugin(project) {
  for (const name of ["core", "opencode"]) {
    const dest = name === "opencode" ? join(project, ".opencode/plugins/goat") : join(project, "node_modules/@goat/core")
    const src = new URL(`../../packages/${name}/`, import.meta.url)
    await mkdir(dest, { recursive: true })
    await cp(new URL("package.json", src), join(dest, "package.json"))
    await cp(new URL("src", src), join(dest, "src"), { recursive: true })
  }
}
