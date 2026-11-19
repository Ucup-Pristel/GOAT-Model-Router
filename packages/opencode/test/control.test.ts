import assert from "node:assert/strict"
import test from "node:test"
import plugin from "../src/index.js"
import { Goat } from "../src/rpc.js"

type JsonSchemaShape = {
  readonly type?: string
  readonly properties?: Readonly<Record<string, JsonSchemaShape>>
  readonly required?: readonly string[]
  readonly items?: JsonSchemaShape
  readonly additionalProperties?: boolean
}

function assertSchema(value: unknown, schema: JsonSchemaShape, path = "$"): void {
  if (schema.type === "object") {
    assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${path} must be an object`)
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? []) assert.ok(Object.hasOwn(record, key), `Missing key at ${path}.${key}`)
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) assert.ok(schema.properties && Object.hasOwn(schema.properties, key), `Unexpected key at ${path}.${key}`)
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(record, key)) assertSchema(record[key], child, `${path}.${key}`)
    }
    return
  }
  if (schema.type === "array") {
    assert.ok(Array.isArray(value), `${path} must be an array`)
    for (const item of value) assertSchema(item, schema.items!, `${path}[]`)
    return
  }
  if (schema.type === "string") assert.equal(typeof value, "string", `${path} must be a string`)
  if (schema.type === "number") assert.equal(typeof value, "number", `${path} must be a number`)
  if (schema.type === "boolean") assert.equal(typeof value, "boolean", `${path} must be a boolean`)
}

test("command RPC persists ON/OFF and mode without generating model responses", async () => {
  let config: unknown
  let handler: ((input: { input: string }) => Promise<{ text: string }>) | undefined
  let catalogReads = 0
  await plugin.setup({
    rpc: { register: async (_definition: unknown, handlers: { command: typeof handler }) => { handler = handlers.command! } },
    storage: { get: async () => config, set: async (_key: string, value: unknown) => { config = value } },
    model: { list: async () => { catalogReads++; return { data: [] } } },
    provider: { list: async () => ({ data: [] }) },
  } as never)
  assert.match((await handler!({ input: "status" })).text, /Enabled: false/)
  await handler!({ input: "on" })
  assert.match((await handler!({ input: "status" })).text, /Enabled: true/)
  await handler!({ input: "mode resink" })
  assert.match((await handler!({ input: "status" })).text, /Mode: resink/)
  await handler!({ input: "off" })
  assert.match((await handler!({ input: "status" })).text, /Enabled: false/)
  assert.equal(catalogReads, 4)
})

test("setConfig rejects malformed shapes instead of silently normalizing", async () => {
  let stored: unknown
  let handlers: { setConfig: (input: { config: unknown }) => Promise<unknown> } | undefined
  await plugin.setup({
    rpc: { register: async (_definition: unknown, value: typeof handlers) => { handlers = value! } },
    storage: { get: async () => stored, set: async (_key: string, value: unknown) => { stored = value } },
    model: { list: async () => ({ data: [] }) },
    provider: { list: async () => ({ data: [] }) },
  } as never)
  const base = { version: 1, enabled: true, mode: "standard", inheritManagerModel: true, models: {} }
  await assert.rejects(handlers!.setConfig({ config: { ...base, models: [] } }), /Invalid GOAT configuration/)
  await assert.rejects(handlers!.setConfig({ config: { ...base, models: new Date(0) } }), /Invalid GOAT configuration/)
  await assert.rejects(handlers!.setConfig({ config: { ...base, models: Object.create({ l1: { providerID: "opencode", modelID: "m" } }) } }), /Invalid GOAT configuration/)
  await assert.rejects(handlers!.setConfig({ config: { ...base, models: { l4: { providerID: "opencode", modelID: "m" } } } }), /Unknown GOAT model role: l4/)
  await assert.rejects(handlers!.setConfig({ config: { ...base, models: { l1: { providerID: "opencode" } } } }), /Invalid l1 model reference/)
  await assert.rejects(handlers!.setConfig({ config: { ...base, models: { l1: Object.create({ providerID: "opencode", modelID: "m" }) } } }), /Invalid l1 model reference/)
  await assert.rejects(handlers!.setConfig({ config: { ...base, extra: true } }), /Invalid GOAT configuration/)
  assert.equal(stored, undefined)
  await handlers!.setConfig({ config: base })
  assert.deepEqual(stored, base)
})

test("getConfig RPC returns validated OFF-default config envelope", async () => {
  let handlers: { getConfig: () => Promise<unknown> } | undefined
  await plugin.setup({
    rpc: { register: async (_definition: unknown, value: typeof handlers) => { handlers = value! } },
    storage: { get: async () => undefined, set: async () => undefined },
  } as never)
  assert.deepEqual(await handlers!.getConfig(), { config: { version: 1, enabled: false, mode: "standard", inheritManagerModel: true, models: {} } })
})

test("getConfig handler output satisfies the declared RPC schema (regression: missing config)", async () => {
  let handlers: { getConfig: () => Promise<unknown> } | undefined
  await plugin.setup({
    rpc: { register: async (_definition: unknown, value: typeof handlers) => { handlers = value! } },
    storage: { get: async () => undefined, set: async () => undefined },
  } as never)
  const schema = Goat.methods.getConfig.output as JsonSchemaShape
  assertSchema(await handlers!.getConfig(), schema)
  assert.throws(
    () => assertSchema({ version: 1, enabled: false, mode: "standard", inheritManagerModel: true, models: {} }, schema),
    /Missing key at \$\.config/,
  )
})
