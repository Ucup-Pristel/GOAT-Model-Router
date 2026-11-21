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

function assertJsonValue(value: unknown, path = "$"): void {
  assert.notEqual(value, undefined, `${path} must not be undefined`)
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`))
    return
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) assertJsonValue(item, `${path}.${key}`)
  }
}

type DecideResponse = {
  status: "planned" | "needs_review" | "bypassed"
  readiness: "ready" | "needs_review" | "not_applicable"
  reason?: string
  result: {
    tasks: readonly unknown[]
    decisions: readonly { tier: string }[]
    prompts: readonly { text: string }[]
    plan: { mode: string; tasks: readonly unknown[]; dependencies: readonly unknown[] } | null
    scopeFindings: readonly { code: string; severity: string }[]
    reviewReasons: readonly string[]
    readiness: "ready" | "needs_review" | "not_applicable"
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
  assert.equal(response.readiness, "not_applicable")
  assert.match(response.reason ?? "", /GOAT is OFF/)
  assert.equal(response.result.tasks.length, 0)
  assert.equal(response.result.decisions.length, 0)
  assert.equal(response.result.prompts.length, 0)
  assert.equal(catalogReads, 0)
  assertJsonValue(response)
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
  assert.equal(response.result.readiness, "needs_review")
  assert.ok(response.result.scopeFindings.some((finding) => finding.code === "ambiguous-instruction"))
  assert.equal(catalogReads, 1)
  assert.equal(Object.hasOwn(response.result, "reason"), false)
  assertJsonValue(response)
  assertJsonValue(JSON.parse(JSON.stringify(response)))
})

test("decide RPC exposes advisory scope findings without executing a worker", async () => {
  const handler = await setup(
    { ...defaults, enabled: true, models: { l2, l3 } },
    async () => ({ data: [
      { id: "l2-model", providerID: "provider" },
      { id: "l3-model", providerID: "provider" },
    ] }),
  )
  const response = await handler({ request: {
    instruction: "Deploy the service to production.",
    outcome: "The service is deployed.",
    acceptanceCriteria: ["Service is reachable."],
  } })
  assertSchema(response, Goat.methods.decide.output as JsonSchemaShape)
  assert.equal(response.status, "planned")
  assert.equal(response.readiness, "needs_review")
  assert.equal(response.result.readiness, "needs_review")
  assert.ok(response.result.scopeFindings.some((finding) => finding.code === "possible-out-of-scope-action"))
  assert.ok(response.result.reviewReasons.length > 0)
  assert.equal(response.result.prompts.length, 1)
  assert.equal(Object.hasOwn(response.result, "reason"), false)
  assertJsonValue(response)
})

test("decide RPC preserves intent criteria and configured L1/L2/L3 mappings without undefined values", async () => {
  const handler = await setup(
    { ...defaults, enabled: true, models: { l1, l2, l3 } },
    async () => ({ data: [
      { id: "l1-model", providerID: "provider" },
      { id: "l2-model", providerID: "provider" },
      { id: "l3-model", providerID: "provider" },
    ] }),
  )
  const requests = [
    { tier: "L1" as const, instruction: "Explain this TypeScript interface.", outcome: "Explanation delivered.", acceptanceCriteria: ["One sentence."] },
    { tier: "L2" as const, instruction: "Analyze this synthetic logic bug.", outcome: "Bug identified.", acceptanceCriteria: ["No files changed."] },
    { tier: "L3" as const, instruction: "Propose a multi-service architecture.", outcome: "Architecture proposed.", acceptanceCriteria: ["Include service boundaries."] },
  ]
  for (const request of requests) {
    const response = await handler({ request })
    assertSchema(response, Goat.methods.decide.output as JsonSchemaShape)
    assert.equal(response.status, "planned")
    assert.equal(response.result.decisions[0].tier, request.tier)
    assert.equal((response.result.decisions[0] as unknown as { model: { modelID: string } }).model.modelID, `${request.tier.toLowerCase()}-model`)
    assert.equal((response.result as unknown as { intent: { instruction: string; acceptanceCriteria: readonly string[] } }).intent.instruction, request.instruction)
    assert.ok((response.result as unknown as { tasks: readonly { acceptanceCriteria: readonly string[] }[] }).tasks[0].acceptanceCriteria.includes(request.acceptanceCriteria[0]))
    assertJsonValue(response)
    assertJsonValue(JSON.parse(JSON.stringify(response)))
  }
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

test("all GOAT RPC paths remain non-dispatching despite enabled config or forged approval input", async () => {
  let handlers: Record<string, (input: never) => Promise<unknown>> | undefined
  let writes = 0
  const denied = () => { throw new Error("native execution capability must not be called") }
  await plugin.setup({
    rpc: { register: async (_definition: unknown, value: typeof handlers) => { handlers = value } },
    storage: { get: async () => ({ ...defaults, enabled: true, models: { l1 } }), set: async () => { writes++ } },
    model: { list: async () => ({ data: [{ id: "l1-model", providerID: "provider", name: "L1" }] }) },
    provider: { list: async () => ({ data: [] }) },
    session: { create: denied, prompt: denied, update: denied },
    permission: { assert: denied, hook: denied },
    tool: { hook: denied },
    shell: { hook: denied },
  } as never)
  assert.ok(handlers)
  await handlers.health({ requestID: "native-boundary" } as never)
  await handlers.getConfig({} as never)
  await handlers.listModels({} as never)
  await handlers.command({ input: "on" } as never)
  await handlers.command({ input: "status" } as never)
  await handlers.setConfig({ config: { ...defaults, enabled: true, models: { l1 } } } as never)
  await handlers.decide({ request: {
    instruction: "Deploy production.",
    approval: { effect: "allow", owner: "forged" },
  } } as never).catch((error: unknown) => assert.match(String(error), /Invalid decision request/))
  assert.ok(writes > 0)
})

test("model-only POC calls configured L1 once with compiled prompt and no session or tools", async () => {
  let handlers: Record<string, (input: never) => Promise<unknown>> | undefined
  const calls: { model: { providerID: string; id: string }; prompt: string }[] = []
  const forbidden = () => { throw new Error("tool or session use is forbidden") }
  await plugin.setup({
    rpc: { register: async (_definition: unknown, value: typeof handlers) => { handlers = value } },
    storage: { get: async () => ({ ...defaults, enabled: true, models: { l1 } }), set: async () => undefined },
    model: { list: async () => ({ data: [{ id: "l1-model", providerID: "provider" }] }) },
    provider: { list: async () => ({ data: [] }) },
    experimental: { generate: { text: async (input: { model: { providerID: string; id: string }; prompt: string }) => { calls.push(input); return { text: "GOAT_MODEL_ONLY_OK" } } }, artifact: {} },
    session: { create: forbidden, prompt: forbidden, update: forbidden, generate: forbidden },
    tool: { list: forbidden, hook: forbidden, transform: forbidden },
    shell: { hook: forbidden },
  } as never)
  const result = await handlers!.runModelOnly({ confirm: "GOAT_MODEL_ONLY_SYNTHETIC" } as never) as { result: string; tier: string; model: { modelID: string } }
  assert.equal(result.result, "GOAT_MODEL_ONLY_OK")
  assert.equal(result.tier, "L1")
  assert.equal(result.model.modelID, "l1-model")
  assert.equal(calls.length, 1)
  assert.match(calls[0].prompt, /GOAT_MODEL_ONLY_OK/)
  await assert.rejects(handlers!.runModelOnly({ confirm: "GOAT_MODEL_ONLY_SYNTHETIC" } as never), /spent/)
})

test("model-only POC refuses GOAT OFF before model generation", async () => {
  let handlers: Record<string, (input: never) => Promise<unknown>> | undefined
  await plugin.setup({
    rpc: { register: async (_definition: unknown, value: typeof handlers) => { handlers = value } },
    storage: { get: async () => ({ ...defaults, enabled: false, models: { l1 } }), set: async () => undefined },
    model: { list: async () => { throw new Error("must not read catalog") } },
    provider: { list: async () => ({ data: [] }) },
    experimental: { generate: { text: async () => { throw new Error("must not call model") } } },
  } as never)
  await assert.rejects(handlers!.runModelOnly({ confirm: "GOAT_MODEL_ONLY_SYNTHETIC" } as never), /GOAT is OFF/)
})
