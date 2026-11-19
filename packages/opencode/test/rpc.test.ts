import assert from "node:assert/strict"
import test from "node:test"
import plugin from "../src/index.js"

test("server registers read-only health RPC and echoes request ID", async () => {
  let id = ""
  let handlers: { health: (input: { requestID: string }) => Promise<unknown> } | undefined
  await plugin.setup({
    rpc: { register: async (definition: { id: string }, value: typeof handlers) => { id = definition.id; handlers = value! } },
    storage: { get: async () => undefined, set: async () => undefined },
  } as never)
  assert.equal(id, "goat.model-router")
  assert.deepEqual(await handlers!.health({ requestID: "probe-1" }), {
    pluginID: "goat.model-router", active: true, handled: true, protocolVersion: "1", requestID: "probe-1",
  })
})
