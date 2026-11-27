import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { promisify } from "node:util"
import { setTimeout as delay } from "node:timers/promises"
import { startHost } from "./host-fixture.mjs"

const exec = promisify(execFile)

test("native package install, cross-workspace scope, update and uninstall", { timeout: 90000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "goat-packages-"))
  const bin = process.env.OPENCODE_BIN || "opencode"
  t.after(() => rm(root, { recursive: true, force: true }))
  const metadata = new Map(), archives = new Map()
  // The real installer sees only these two registry packages. The predecessor
  // is manufactured locally so updating never requires an npm publication.
  const registry = createServer((req, res) => {
    const key = decodeURIComponent(req.url.slice(1))
    if (archives.has(key)) return res.end(archives.get(key))
    if (!metadata.has(key)) return res.writeHead(404).end()
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify(metadata.get(key)))
  })
  registry.listen(0, "127.0.0.1")
  await once(registry, "listening")
  t.after(() => registry.close())
  const url = `http://127.0.0.1:${registry.address().port}`
  const host = await startHost(t, () => assert.fail("No model requests expected"), false, { registry: url })
  const env = host.env
  const run = async (binary, args, cwd = root) => (await exec(binary, args, { cwd, env, timeout: 20000 })).stdout
  await writeFile(join(env.HOME, ".npmrc"), `registry=${url}\n`)
  const { version } = JSON.parse(await readFile(new URL("../../package.json", import.meta.url)))
  for (const part of ["core", "opencode"]) {
    const name = `@goat/${part}`
    const versions = {}
    const dir = join(root, part)
    await mkdir(dir)
    for (const revision of [version, "0.0.0"]) {
      const filename = `goat-${part}-${revision}.tgz`
      const archive = join(root, filename)
      if (revision === version) {
        await writeFile(archive, await readFile(new URL(`../../dist/${filename}`, import.meta.url)))
        await run("tar", ["-xzf", archive, "-C", dir, "--strip-components=1"])
      } else {
        const manifest = { ...versions[version], version: revision }
        delete manifest.dist
        if (part === "opencode") manifest.dependencies = { "@goat/core": revision }
        await writeFile(join(dir, "package.json"), JSON.stringify(manifest))
        await run("npm", ["pack", "--ignore-scripts", "--pack-destination", root], dir)
      }
      const manifest = JSON.parse(await readFile(join(dir, "package.json")))
      const data = await readFile(archive)
      archives.set(filename, data)
      versions[revision] = { ...manifest, dist: { tarball: `${url}/${filename}`, shasum: createHash("sha1").update(data).digest("hex") } }
    }
    metadata.set(name, { name, "dist-tags": { latest: "0.0.0" }, versions })
  }
  const config = join(env.XDG_CONFIG_HOME, "opencode")
  await mkdir(config, { recursive: true })
  const configFile = join(config, "opencode.json")
  const keep = { plugins: ["-unrelated.plugin"], update: "disable", warming: false,
    providers: { local: { package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: url, apiKey: "mock-only" }, models: { mock: {} } } },
    mcp: { servers: { preserved: { type: "remote", url, disabled: true } } }, permissions: [{ action: "shell", resource: "*", effect: "deny" }] }
  await writeFile(configFile, JSON.stringify(keep))
  const authFile = join(env.XDG_DATA_HOME, "opencode/auth.json")
  const mockAuth = '{"fixture":{"type":"api","key":"local-canary"}}'
  await writeFile(authFile, mockAuth, {mode: 0o600})
  const projects = ["a", "b"].map(p => join(root, p))
  for (const dir of projects) {
    await mkdir(dir)
    await run("git", ["init", "-q"], dir)
    await run("git", ["-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-qm", dir, "--allow-empty"], dir)
  }
  const [a, b] = projects
  const target = "@goat/opencode"
  const rpc = async (dir, method, input = {}) => (await host.api(`rpc/goat.model-router/${method}`, "POST", {input}, dir)).output
  const info = async dir => (await host.api("plugin", "GET", undefined, dir)).find(p => p.id === "goat.model-router")
  async function loaded(dir, revision) {
    const end = Date.now() + 8000
    for (;;) {
      const plugin = await info(dir)
      if (plugin?.source.version === revision) {
        assert.deepEqual(plugin.features, { server: true, tui: true, rpc: true })
        return
      }
      assert.ok(Date.now() < end, `Expected ${revision}, got ${JSON.stringify(plugin)}`)
      await delay(100)
    }
  }
  await run(bin, ["plugin", "add", target], a)
  assert.deepEqual(JSON.parse(await readFile(configFile)), { ...keep, plugins: [...keep.plugins, target] })
  await loaded(a, "0.0.0")
  await loaded(b, "0.0.0")
  const fresh = (await rpc(a, "getConfig")).config
  assert.equal(fresh.enabled, false)
  const models = { l1: { providerID: "fixture", modelID: "mock" } }
  await rpc(a, "setConfig", {config: {...fresh, models}})
  await rpc(a, "command", { input: "mode resink" })
  await rpc(a, "command", { input: "on" })
  const other = (await rpc(b, "getConfig")).config
  assert.equal(other.enabled, true)
  assert.equal(other.mode, "resink")
  assert.deepEqual(other.models, models)
  for (const item of metadata.values()) item["dist-tags"].latest = version
  await exec(bin, ["plugin", "update", target, "--server", host.url], {
    cwd: a, env: { ...env, OPENCODE_PASSWORD: host.password }, timeout: 20000,
  })
  await loaded(a, version)
  assert.equal((await rpc(a, "getConfig")).config.enabled, true)
  assert.equal((await rpc(a, "getConfig")).config.mode, "resink")
  await rpc(a, "command", { input: "off" })
  await run(bin, ["plugin", "remove", target], a)
  await host.api("location/reload", "POST")
  assert.deepEqual(JSON.parse(await readFile(configFile)), keep)
  assert.equal(await info(a), undefined)
  assert.equal(await info(b), undefined)
  await writeFile(join(a, "opencode.json"), JSON.stringify({plugins: [`${target}@${version}`]}))
  await host.api("location/reload", "POST")
  await loaded(a, version)
  assert.equal(await info(b), undefined)
  assert.deepEqual((await rpc(a, "getConfig")).config, { ...fresh, mode: "resink", models })
  assert.deepEqual(JSON.parse(await readFile(configFile)), keep)
  assert.equal(host.calls.length, 0)
  assert.equal(await readFile(authFile, "utf8"), mockAuth)
})
