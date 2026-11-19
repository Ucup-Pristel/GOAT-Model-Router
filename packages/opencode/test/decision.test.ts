import assert from "node:assert/strict"
import test from "node:test"
import { defaults } from "@goat/core"
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

type DecideResponse = {
  status: "planned" | "bypassed"
  reason?: string
  result: {
    tasks: readonly unknown[]
    decisions: readonly { tier: string }[]
    prompts: readonly { text: string }[]
    plan: { mode: string; tasks: readonly unknown[]; dependencies: readonly unknown[] } | null
  }
}

type DecideHandler = (input: { request: Record<string, unknown> }) => Promise<DecideResponse>

const l1 = { providerID: "provider", modelID: "l1-model" }
const l2 = { providerID: "provider", modelID: "l2-model" }
const l3 = { providerID: "provider", modelID: "l3-model" }

async function setup(stored: unknown, modelList: () => Promise<{ data: { id: string; providerID: string }[] }> = async () => ({ data: [] })) {
  let handler: DecideHandler | undefined
  await plugin.setup({
    rpc: { register: async (_definition: unknown, value: { decide: DecideHandler }) => { handler = value.decide } },
    storage: { get: async () => stored, set: async () => undefined },
    model: { list: modelList },
    provider: { list: async () => ({ data: [] }) },
  } as never)
  return handler!
}

test("decide RPC bypasses GOAT OFF without reading the model catalog", async () => {
  let catalogReads = 0
  const handler = await setup(
    { ...defaults, enabled: false, models: {} },
    async () => {
      catalogReads++
      return { data: [] }
    },
  )
  const response = await handler({ request: { instruction: "Do the work." } })
  assertSchema(response, Goat.methods.decide.output as JsonSchemaShape)
  assert.equal(response.status, "bypassed")
  assert.match(response.reason ?? "", /GOAT is OFF/)
  assert.equal(response.result.tasks.length, 0)
  assert.equal(response.result.decisions.length, 0)
  assert.equal(response.result.prompts.length, 0)
  assert.equal(catalogReads, 0)
})

test("decide RPC plans a Standard task using live inventory without model generation", async () => {
  let catalogReads = 0
  const handler = await setup(
    { ...defaults, enabled: true, models: { l1 } },
    async () => {
      catalogReads++
      return { data: [{ id: "l1-model", providerID: "provider" }] }
    },
  )
  const response = await handler({ request: { instruction: "Reply with OK." } })
  assertSchema(response, Goat.methods.decide.output as JsonSchemaShape)
  assert.equal(response.status, "planned")
  assert.equal(response.result.plan, null)
  assert.equal(response.result.tasks.length, 1)
  assert.equal(response.result.decisions[0].tier, "L1")
  assert.match(response.result.prompts[0].text, /Original task objective/)
  assert.equal(catalogReads, 1)
})

test("decide RPC honors an explicit capability tier", async () => {
  const handler = await setup(
    { ...defaults, enabled: true, models: { l1, l2, l3 } },
    async () => ({ data: [
      { id: "l1-model", providerID: "provider" },
      { id: "l2-model", providerID: "provider" },
      { id: "l3-model", providerID: "provider" },
    ] }),
  )
  const response = await handler({ request: { instruction: "Reply with OK.", tier: "L3" } })
  assertSchema(response, Goat.methods.decide.output as JsonSchemaShape)
  assert.equal(response.result.decisions[0].tier, "L3")
  await assert.rejects(handler({ request: { instruction: "Reply with OK.", tier: "L4" } }), /capability tier/)
})

test("decide RPC uses live inventory for Resink planning and does not execute work", async () => {
  let catalogReads = 0
  const handler = await setup(
    { ...defaults, enabled: true, mode: "resink", models: { l1, l2, l3 } },
    async () => {
      catalogReads++
      return { data: [
        { id: "l1-model", providerID: "provider" },
        { id: "l2-model", providerID: "provider" },
        { id: "l3-model", providerID: "provider" },
      ] }
    },
  )
  const response = await handler({ request: { instruction: "1. Create the API.\n2. Add tests." } })
  assertSchema(response, Goat.methods.decide.output as JsonSchemaShape)
  assert.equal(response.status, "planned")
  assert.ok(response.result.plan)
  assert.equal(response.result.plan.mode, "resink")
  assert.equal(response.result.plan.tasks.length, 2)
  assert.equal(response.result.plan.dependencies.length, 1)
  assert.equal(catalogReads, 1)
})

test("decide RPC rejects malformed requests", async () => {
  const handler = await setup({ ...defaults, enabled: true, models: { l1 } })
  await assert.rejects(handler({ request: { instruction: "Do work.", unexpected: true } }), /Invalid decision request/)
  await assert.rejects(handler({ request: { instruction: "Do work.", availableModels: [] } }), /Invalid decision request/)
  await assert.rejects(handler({ request: { instruction: "" } }), /instruction is required/)
})
