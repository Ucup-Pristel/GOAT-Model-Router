import assert from "node:assert/strict"
import test from "node:test"
import { deny, model, startHost } from "./host-fixture.mjs"

test("OpenCode native controls (local provider; no GOAT dispatcher)", { timeout: 120000 }, async t => {
  const { api, session, prompt, wait, file, outside, calls, nextSlow } = await startHost(t)
  const read = { action: "read", resource: "*", effect: "allow" }
  const context = id => api(`session/${id}/context`)
  const toolResults = messages => messages.flatMap(m => (m.content || []).filter(c => c.type === "tool"))
  async function run(id, text) {
    const start = calls.length
    await prompt(id, text)
    await wait(id)
    return { messages: await context(id), rounds: calls.slice(start) }
  }
  await t.test("T5: last of three rounds rejects another tool call", async () => {
    const id = await session([...deny, read], { agent: "bounded" })
    const { messages, rounds } = await run(id, "LOOP_TOOL")
    assert.equal(rounds.length, 3)
    const tools = toolResults(messages)
    assert.equal(tools.length, 3)
    assert.match(JSON.stringify(tools[0].state), /LOCAL_FIXTURE/)
    assert.match(tools[2].state.error.message, /maximum agent steps/i)
  })
  await t.test("T6: interrupt an active prompt; provider connection closes", { timeout: 10000 }, async () => {
    const id = await session()
    const start = calls.length
    const arrived = nextSlow()
    await prompt(id, "SLOW_RESPONSE")
    const { closed } = await arrived
    assert.equal((await api(`session/${id}/interrupt`, "POST")).interrupted, true)
    await wait(id)
    assert.equal(await closed, true)
    assert.equal((await api(`session/${id}`)).outcome, "interrupted")
    assert.equal(calls.length - start, 1)
  })
  await t.test("T7 and T17 native control: targeted deny rejects the outside fixture read", async () => {
    const id = await session([...deny, read, { action: "read", resource: outside, effect: "deny" }])
    const { messages, rounds } = await run(id, "USE_TOOL OUTSIDE")
    assert.ok(rounds[0].tools.includes("read"))
    const [tool] = toolResults(messages)
    assert.equal(tool.state.input.path, outside)
    assert.equal(tool.state.error?.type, "permission.rejected")
    assert.ok(!JSON.stringify(messages).includes("OUTSIDE_CANARY_CONTENT"))
  })
  await t.test("T8: deny-all advertises no tools; T9 native usage observation", async () => {
    const id = await session()
    const { messages, rounds } = await run(id, "USE_TOOL")
    assert.deepEqual(rounds, [{ tools: [], max_tokens: 4096 }])
    assert.deepEqual(toolResults(messages), [])
    const { tokens } = await api(`session/${id}`)
    assert.equal(tokens.input, 11)
    assert.equal(tokens.output, 7)
  })
  await t.test("T15/T16 native controls: session permissions mutable; always saves project rule", async () => {
    const id = await session()
    const check = () => api(`session/${id}/permission`, "POST", { action: "read", resources: [file], save: [file] })
    assert.equal((await check()).effect, "deny")
    await api(`session/${id}`, "PATCH", { permissions: [{ ...read, effect: "ask" }] })
    const req = await check()
    assert.equal(req.effect, "ask")
    await api(`session/${id}/permission/${req.id}/reply`, "POST", { decision: "always" })
    assert.equal((await check()).effect, "allow")
    assert.ok((await api("permission/saved")).some(rule => rule.resource === file && rule.action === "read"))
  })
  await t.test("T18: transient generation advertises read but does not run its tool loop; interrupt misses it", { timeout: 16000 }, async () => {
    const id = await session([...deny, read])
    const generate = text => api(`session/${id}/generate`, "POST", { prompt: text })
    const start = calls.length
    assert.equal((await generate("USE_TOOL")).text, "")
    assert.equal(calls.length - start, 1)
    assert.ok(calls[start].tools.includes("read"))
    assert.deepEqual(await context(id), [])
    const arrived = nextSlow()
    const pending = generate("SLOW_RESPONSE")
    const { finish } = await Promise.race([arrived, pending.then(() => { throw Error("Slow generation finished before release") })])
    try { assert.equal((await api(`session/${id}/interrupt`, "POST")).interrupted, false) }
    finally { finish(); assert.equal((await pending).text, "MOCK_OK") }
  })
  await t.test("T19: stateless generation returns text without tools or a new session", async () => {
    const before = await api("session")
    const start = calls.length
    assert.deepEqual(await api("experimental/generate/text", "POST", { prompt: "USE_TOOL", model }), { text: "MOCK_OK" })
    assert.equal(calls.length - start, 1)
    assert.deepEqual(calls[start].tools, [])
    assert.deepEqual(await api("session"), before)
  })
  await t.test("Budget control: count auxiliary provider requests for an untitled session", async () => {
    const id = await session(deny, { title: undefined })
    const { messages, rounds } = await run(id, "Summarize the synthetic example.")
    assert.equal(messages.filter(m => m.type === "assistant").length, 1)
    assert.ok(rounds.length > 1, `expected auxiliary request; observed ${rounds.length} total`)
  })
  t.diagnostic(`All requests at the separate native-control provider: ${calls.length}`)
})

// Keep absent end-to-end contracts visible in TAP; host probes are not passes
// for a GOAT feature. Replace a skip with its assertions when the boundary exists.
for (const [id, missing] of Object.entries({
  T2: "owner-authorized dispatcher and denial trace",
  T3: "owner credential verification at dispatch", T4: "native child tier dispatch (root tier routing covered by plugin RPC)",
  T9: "pipeline budget stop after observed overshoot", T10: "protected trace", T11: "scoped evidence-file reads (deny-all text Auditor covered)",
  T14: "dispatcher depth enforcement",
  T15: "in-flight mutation detection", T16: "owner check following saved allow", T17: "worker-scoped worktree",
})) test.skip(`${id} BLOCKED: ${missing}`, () => {})
