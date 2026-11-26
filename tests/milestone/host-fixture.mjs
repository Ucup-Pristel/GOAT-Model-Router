import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { once } from "node:events"
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { generateKeyPairSync, randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { checkVersion, codingAgents, projectAgents, signProject, deny, installPrivatePlugin } from "./private-plugin.mjs"
import { fileURLToPath } from "node:url"

export { deny }
export const model = { providerID: "fixture", id: "mock" }

// Start a private host, not the user's service. Register cleanup before any
// subsequent operation can fail. The only tool the mock can request is read.
export async function startHost(t, syntheticReply, plugin = false, options = {}) {
  const multi = plugin === "project"
  const coding = plugin === "coding" || multi
  const binary = process.env.OPENCODE_BIN || "opencode"
  const root = await mkdtemp(join(tmpdir(), "goat-audit-"))
  const project = join(root, "project")
  const file = join(project, "example.txt")
  const outside = join(root, "outside.txt")
  const env = { PATH: process.env.PATH, HOME: root, TMPDIR: root, OPENCODE_CONFIG: join(project, "opencode.json"),
    XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"),
    XDG_STATE_HOME: join(root, "state"), HTTP_PROXY: "http://127.0.0.1:1", HTTPS_PROXY: "http://127.0.0.1:1",
    NO_PROXY: "localhost,127.0.0.1" }
  let host, exited
  const calls = []
  let slow, slowRoleSeen = false
  const provider = createServer(async (req, res) => {
    // Record arrival before decoding or rejecting: auxiliary host requests and
    // unexpected endpoints must be visible to the scenario's budget checks.
    const call = {}
    calls.push(call)
    if (req.url !== "/v1/chat/completions") return res.writeHead(404).end()
    let raw = ""
    for await (const part of req) raw += part
    const { model: id, messages, tools = [], tool_choice, max_tokens, max_completion_tokens } = JSON.parse(raw)
    const prompt = messages.filter(m => m.role === "user").map(m => JSON.stringify(m.content)).join("\n")
    const readCount = messages.filter(m => m.role === "tool").length
    Object.assign(call, { tools: tools.map(t => t.function.name), max_tokens: max_tokens ?? max_completion_tokens })
    let text = "MOCK_OK"
    if (syntheticReply) {
      const content = messages.findLast(m => m.role === "user")?.content
      const userText = Array.isArray(content) ? content.map(part => part.text ?? "").join("") : content
      // Count even unexpected/over-budget requests before rejecting them.
      Object.assign(call, { model: id, userText })
      try {
        if (coding) assert.ok(call.tools.every(name => ["goat_task_file", "goat_verify_text", "skill"].includes(name)))
        else if (plugin !== "conversation") assert.equal(tools.length, 0, "synthetic sessions must not advertise tools")
        else assert.ok(call.tools.every(name => ["goat_verify_text", "skill"].includes(name)))
        text = syntheticReply(call, { messages, tool_choice })
      } catch (error) {
        return res.writeHead(400).end(JSON.stringify({ error: { message: String(error) } }))
      }
    }
    const chunk = (choices, usage) => res.write(`data: ${JSON.stringify({
      id: "mock", object: "chat.completion.chunk", created: 1, model: id, choices, usage,
    })}\n\n`)
    res.writeHead(200, { "content-type": "text/event-stream" })
    const finish = () => {
      const useRead = (prompt.includes("LOOP_TOOL") ? readCount < 6 : !readCount && prompt.includes("USE_TOOL"))
        && tools.some(t => t.function.name === "read")
      const batch = Array.isArray(text) ? text : [text]
      const useGoat = (plugin === "conversation" || coding) && batch.every(t => call.tools.includes(t?.tool) ||
        options.attemptSubagent && t?.tool === "subagent")
      const delta = useGoat ? { tool_calls: batch.map((t, index) => ({ index, type: "function", id: `goat_${calls.length}_${index}`,
        function: { name: t.tool, arguments: JSON.stringify(t.args ?? {}) } })) } : useRead ? { tool_calls: [{ index: 0, type: "function", id: `read_${readCount}`,
        function: { name: "read", arguments: JSON.stringify({ path: prompt.includes("OUTSIDE") ? outside : file }) } }] }
        : { content: text }
      chunk([{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: null }])
      chunk([{ index: 0, delta: {}, finish_reason: useRead || useGoat ? "tool_calls" : "stop" }])
      const inputTokens = options.inputTokens ?? 11
      chunk([], { prompt_tokens: inputTokens, completion_tokens: 7, total_tokens: inputTokens + 7 })
      res.end("data: [DONE]\n\n")
    }
    if (!prompt.includes("SLOW_RESPONSE") && (slowRoleSeen || id !== options.slowFirstRole)) return finish()
    slowRoleSeen = true
    res.write(": started\n\n")
    const timer = setInterval(() => res.write(": ping\n\n"), 100)
    const closed = once(res, "close").then(() => !res.writableEnded)
    res.once("close", () => clearInterval(timer))
    slow?.resolve({ finish, closed })
  })
  t.after(async () => {
    if (host && host.exitCode === null && !host.signalCode) { host.kill("SIGKILL"); await exited }
    provider.closeAllConnections()
    if (provider.listening) await new Promise(resolve => provider.close(resolve))
    await rm(root, { recursive: true, force: true })
  })
  const version = execFileSync(binary, ["--version"], { cwd: root, env, encoding: "utf8", timeout: 5000 }).trim()
  checkVersion(version, process.env.GOAT_TEST_VERSION ?? "2.3.2")
  t.diagnostic(`Private test host: ${version}`)
  await mkdir(project)
  await writeFile(file, "LOCAL_FIXTURE\n")
  await writeFile(outside, "OUTSIDE_CANARY_CONTENT\n")
  provider.listen(0, "127.0.0.1")
  await once(provider, "listening")
  const endpoint = `http://127.0.0.1:${provider.address().port}/v1`
  if (plugin) {
    await installPrivatePlugin(project)
    Object.assign(env, { GOAT_TEXT_PROJECT: project, GOAT_TEXT_CAPABILITY: randomBytes(32).toString("hex"), GOAT_TEXT_PROVIDER: endpoint })
    if (plugin === "conversation") env.GOAT_TEXT_CONVERSATION = "1"
    if (coding) {
      delete env.GOAT_TEXT_PROVIDER
      Object.assign(env, { GOAT_LIVE_PROFILE: "coding", GOAT_TEXT_CONVERSATION: "1", GOAT_CODE_MANIFEST: join(root, "task.json") })
      if (multi) {
        const keys = generateKeyPairSync("ed25519")
        await signProject(env, { project: fileURLToPath(new URL("./example-project", import.meta.url)),
          edit: ["labels.py", "normalize.py"], test: ["test_labels.py"], instruction: options.instruction, step: options.step },
          keys.privateKey, keys.publicKey.export({ type: "spki", format: "pem" }))
      } else await cp(new URL("./live-task.json", import.meta.url), env.GOAT_CODE_MANIFEST)
    }
  }
  const config = {
    ...(plugin && { plugins: ["./.opencode/plugins/goat"] }),
    ...(coding && { permissions: deny }),
    model: coding ? "owner-lab/manager" : "fixture/mock", update: "disable", warming: false,
    providers: { fixture: { package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: endpoint, apiKey: "fixture-only" },
      models: { mock: { limit: { context: 100000, output: 4096 } },
        ...(syntheticReply && { auditor: { limit: { context: 100000, output: 4096 } } }),
        ...(plugin && { middle: {}, senior: {} }) } },
      ...(coding && Object.fromEntries(["owner-lab", "review-lab"].map(id => [id, {
        package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: endpoint, apiKey: "fixture-only" },
        models: id === "owner-lab" ? { manager: {}, implementer: {} } : { reviewer: {} },
      }]))) },
    agents: { bounded: { model: "fixture/mock", steps: 3 }, ...(plugin && { "goat-local-text": { steps: 1, permissions: deny } }),
      ...(coding && (multi ? projectAgents : codingAgents)), ...(plugin === "conversation" && { build: codingAgents.build }) },
  }
  await writeFile(env.OPENCODE_CONFIG, JSON.stringify(config))
  // Stateless generation does not take a project location. Supply the same
  // mock inventory at the private host's default scope (never the user's).
  const base = join(env.XDG_CONFIG_HOME, "opencode")
  if (!syntheticReply) {
    await mkdir(base, { recursive: true })
    await writeFile(join(base, "opencode.json"), JSON.stringify({
      model: config.model, providers: config.providers, update: "disable", warming: false,
    }))
  }
  host = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: project, env, stdio: ["ignore", "pipe", "pipe"],
  })
  exited = once(host, "exit")
  let url, auth
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Private host startup timed out")), 12000)
    exited.then(() => { clearTimeout(timer); reject(Error("Private host exited")) }, reject)
    for (const stream of [host.stdout, host.stderr]) {
      createInterface({ input: stream }).on("line", line => {
        url ??= line.match(/server listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
        auth ??= line.match(/server password (\S+)/)?.[1]
        if (url && auth) { clearTimeout(timer); resolve() }
      })
    }
  })
  async function api(path, method = "GET", body, directory = project) {
    const target = new URL(`${url}/api/${path}`)
    if (path === "model" || path === "plugin" || path.startsWith("rpc/")) target.searchParams.set("location[directory]", directory)
    const res = await fetch(target, { method, signal: AbortSignal.timeout(12000),
      headers: { authorization: `Basic ${Buffer.from(`opencode:${auth}`).toString("base64")}`, "content-type": "application/json" },
      body: JSON.stringify(body) })
    if (!res.ok) assert.fail(`${method} ${path}: HTTP ${res.status} ${await res.text()}`)
    if (res.status === 204) return
    const json = await res.json()
    return Object.hasOwn(json, "data") ? json.data : json
  }
  // The listener and even plugin.health can be ready before model discovery.
  const expectedModels = Object.entries(config.providers).flatMap(([providerID, p]) => Object.keys(p.models).map(id => `${providerID}/${id}`))
  for (const directory of syntheticReply ? [project] : [project, base]) {
    const deadline = Date.now() + 5000
    for (;;) {
      const inventory = (await api("model", "GET", undefined, directory)).filter(m => m.enabled).map(m => `${m.providerID}/${m.id}`)
      if (expectedModels.every(m => inventory.includes(m))) break
      assert.ok(Date.now() < deadline, `Private host model inventory did not become ready at ${directory}: ${expectedModels.filter(m => !inventory.includes(m))}`)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  // Untitled prompts can also ask the provider for a title. Keep those
  // requests in the counter and name the session explicitly for the step test.
  const session = async (permissions = deny, extra = {}) => (await api("session", "POST", { model, title: "GOAT fixture", permissions, ...(plugin && { location: { directory: project } }), ...extra })).id
  const prompt = (id, text) => api(`session/${id}/prompt`, "POST", { text })
  const wait = id => api(`experimental/session/${id}/wait`, "POST")
  return { api, session, prompt, wait, file, outside, calls, capability: env.GOAT_TEXT_CAPABILITY, nextSlow() {
    slow = Promise.withResolvers()
    return slow.promise
  } }
}
