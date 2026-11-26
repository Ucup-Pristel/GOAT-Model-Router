// Owner-operated only; not imported by npm test or audit:milestone.
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import { isAbsolute, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { checkVersion, codingAgents, deny, installPrivatePlugin } from "./private-plugin.mjs"

const [providerFile, taskFile] = process.argv.slice(2)
const binary = process.env.OPENCODE_BIN
if (!providerFile || !isAbsolute(binary ?? "") || process.platform !== "linux") {
  throw Error("Linux: set absolute OPENCODE_BIN and pass a private JSON file with model and providers")
}
const source = JSON.parse(await readFile(providerFile, "utf8"))
if (typeof source.model !== "string" || !source.providers || Object.keys(source).some(k => !["model", "providers"].includes(k))) {
  throw Error("Pass only model and providers from your trusted OpenCode configuration")
}
process.umask(0o077)
const root = await mkdtemp(join(tmpdir(), "goat-live-"))
const project = join(root, "project")
const env = { HOME: root, TMPDIR: root, PATH: process.env.PATH, TERM: process.env.TERM ?? "xterm-256color",
  LANG: "C.UTF-8", XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"),
  XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"), OPENCODE_CONFIG: join(project, "opencode.json"),
  GOAT_TEXT_PROJECT: project, GOAT_LIVE_PROFILE: "coding", GOAT_TEXT_CONVERSATION: "1",
  GOAT_TEXT_CAPABILITY: randomBytes(32).toString("hex"), GOAT_CODE_MANIFEST: join(root, "task.json") }
// Only explicitly referenced credential variables are forwarded to this host.
for (const [, key] of JSON.stringify(source).matchAll(/\{env:([A-Z][A-Z0-9_]*(?:KEY|TOKEN|PASSWORD))\}/g)) {
  if (!process.env[key]) throw Error(`Missing provider credential variable ${key}`)
  env[key] = process.env[key]
}
const version = execFileSync(binary, ["--version"], { env, cwd: root, encoding: "utf8" }).trim()
checkVersion(version)
const probe = new URL("../../packages/opencode/src/check-python.py", import.meta.url)
if (execFileSync("/usr/bin/python3", ["-ISB", fileURLToPath(probe)], { cwd: "/", env: {}, input: '"probe"', encoding: "utf8" }) !== '"isolated"') {
  throw Error("Cannot establish coding isolation")
}
await installPrivatePlugin(project)
await cp(taskFile ?? new URL("./live-task.json", import.meta.url), env.GOAT_CODE_MANIFEST)
await writeFile(env.OPENCODE_CONFIG, JSON.stringify({ ...source, plugins: ["./.opencode/plugins/goat"], update: "disable", warming: false,
  permissions: deny, agents: codingAgents }))
console.log(`Disposable private host: ${root} (${version})\nSelect Build, configure /goat router, /goat on, then send:\n${JSON.parse(await readFile(env.GOAT_CODE_MANIFEST, "utf8")).instruction}`)
const run = spawnSync(binary, ["--standalone"], { cwd: project, env, stdio: "inherit" })
if (run.error) throw run.error
process.exitCode = run.status ?? 1
