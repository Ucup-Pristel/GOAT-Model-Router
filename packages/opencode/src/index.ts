import { Plugin } from "@opencode/plugin"
import { decideTask, defaults, modelStatus, validateConfig } from "@goat/core"
import { Goat } from "@goat/opencode/rpc"

export default Plugin.define({
  id: "goat.model-router",
  async setup(ctx) {
    let modelOnlyState: "ready" | "running" | "spent" | "timed_out" = "ready"
    await ctx.rpc.register(Goat, {
      health: async (input) => {
        const { requestID } = input as { requestID: string }
        return { pluginID: "goat.model-router", active: true, handled: true, protocolVersion: "1", requestID }
      },
      getConfig: async () => ({ config: validateConfig(await ctx.storage.get("config") ?? defaults) }),
      setConfig: async (input) => {
        const { config } = input as { config: unknown }
        if (!isPlainObject(config)) throw new Error("Invalid GOAT configuration")
        const candidate = config
        if (Object.keys(candidate).some((key) => !["version", "enabled", "mode", "inheritManagerModel", "models"].includes(key))) throw new Error("Invalid GOAT configuration")
        if (candidate.version !== 1 || typeof candidate.enabled !== "boolean" || (candidate.mode !== "standard" && candidate.mode !== "resink") || typeof candidate.inheritManagerModel !== "boolean" || !isPlainObject(candidate.models)) throw new Error("Invalid GOAT configuration")
        const roles = ["manager", "l1", "l2", "l3", "auditor"] as const
        const rawModels = candidate.models
        for (const key of Object.keys(rawModels)) if (!roles.includes(key as typeof roles[number])) throw new Error(`Unknown GOAT model role: ${key}`)
        for (const role of roles) {
          const ref = rawModels[role]
          if (ref === undefined) continue
          if (!isPlainObject(ref)) throw new Error(`Invalid ${role} model reference`)
          if (typeof ref.providerID !== "string" || !ref.providerID || typeof ref.modelID !== "string" || !ref.modelID) throw new Error(`Invalid ${role} model reference`)
          if (Object.keys(ref).some((key) => key !== "providerID" && key !== "modelID")) throw new Error(`Invalid ${role} model reference`)
        }
        const validated = validateConfig(config)
        const previous = validateConfig(await ctx.storage.get("config") ?? defaults)
        if (JSON.stringify(previous.models) !== JSON.stringify(validated.models)) {
          const available = (await ctx.model.list()).data
          for (const model of Object.values(validated.models)) if (model && !available.some((candidate) => candidate.providerID === model.providerID && candidate.id === model.modelID)) throw new Error(`Unavailable model: ${model.providerID}/${model.modelID}`)
        }
        await ctx.storage.set("config", validated)
        return { config: validated }
      },
      listModels: async () => {
        const [models, providers] = await Promise.all([ctx.model.list(), ctx.provider.list()])
        return { models: models.data.map((model) => ({ providerID: model.providerID, modelID: model.id, name: model.name, providerName: providers.data.find((provider) => provider.id === model.providerID)?.name ?? model.providerID })) }
      },
      command: async (input) => {
        const { input: text } = input as { input: string }
        const [verb, ...args] = text.trim().split(/\s+/)
        let config = validateConfig(await ctx.storage.get("config") ?? defaults)
        if (!["on", "off", "mode", "router", "status"].includes(verb)) return { text: "Usage: /goat router|mode|on|off|status" }
        if (verb === "on" || verb === "off") {
          config = { ...config, enabled: verb === "on" }
          await ctx.storage.set("config", config)
          return { text: `GOAT ${verb.toUpperCase()}. Orchestration execution remains disabled: OpenCode has no verified Project Owner identity authority.` }
        }
        if (verb === "mode") {
          const mode = args[0]
          if (mode !== "standard" && mode !== "resink") return { text: "Usage: /goat mode standard|resink" }
          config = { ...config, mode }
          await ctx.storage.set("config", config)
          return { text: `GOAT mode: ${mode}. Manager planning is available; worker execution remains disabled pending verified Project Owner authority.` }
        }
        if (verb === "status") {
          const available = (await ctx.model.list()).data.map((model) => ({ providerID: model.providerID, modelID: model.id }))
          return { text: `Enabled: ${config.enabled}\nMode: ${config.mode}\nManager: ${config.inheritManagerModel ? "inherit session model" : modelStatus(config.models.manager, available)}\nL1: ${modelStatus(config.models.l1, available)}\nL2: ${modelStatus(config.models.l2, available)}\nL3: ${modelStatus(config.models.l3, available)}\nAuditor: ${modelStatus(config.models.auditor, available)}\nOrchestration: disabled (no verified Project Owner authority)` }
        }
        if (verb === "router") {
          return { text: "Use the interactive /goat router menu to configure models." }
        }
        return { text: "Usage: /goat router|mode|on|off|status" }
      },
      decide: async (input) => {
        const request = (input as { request?: unknown }).request
        if (!isPlainObject(request)) throw new Error("Invalid decision request")
        const allowed = ["instruction", "outcome", "userPlan", "constraints", "prohibitions", "acceptanceCriteria", "ambiguities", "permissionBoundaries", "tier"]
        if (Object.keys(request).some((key) => !allowed.includes(key))) throw new Error("Invalid decision request")
        if (typeof request.instruction !== "string" || !request.instruction.trim()) throw new Error("Invalid decision request: instruction is required")
        const config = validateConfig(await ctx.storage.get("config") ?? defaults)
        const availableModels = config.enabled
          ? (await ctx.model.list()).data.map((model) => ({ providerID: model.providerID, modelID: model.id }))
          : undefined
        const result = await decideTask({
          instruction: request.instruction,
          outcome: request.outcome as string | undefined,
          userPlan: request.userPlan as readonly string[] | null | undefined,
          constraints: request.constraints as readonly string[] | undefined,
          prohibitions: request.prohibitions as readonly string[] | undefined,
          acceptanceCriteria: request.acceptanceCriteria as readonly string[] | undefined,
          ambiguities: request.ambiguities as readonly string[] | undefined,
          permissionBoundaries: request.permissionBoundaries as readonly string[] | undefined,
          tier: request.tier as "L1" | "L2" | "L3" | undefined,
          config,
          availableModels,
        })
        const { reason, ...serializableResult } = result
        return reason
          ? { status: result.status, readiness: result.readiness, reason, result: serializableResult }
          : { status: result.status, readiness: result.readiness, result: serializableResult }
      },
      runModelOnly: async (input) => {
        const { confirm } = input as { confirm: string }
        if (confirm !== "GOAT_MODEL_ONLY_SYNTHETIC") throw new Error("Model-only POC requires explicit synthetic confirmation")
        if (modelOnlyState !== "ready") throw new Error(`Model-only POC is unavailable: ${modelOnlyState}`)
        const config = validateConfig(await ctx.storage.get("config") ?? defaults)
        if (!config.enabled) throw new Error("GOAT is OFF; model-only POC bypassed")
        const model = config.models.l1
        if (!model) throw new Error("Model-only POC requires configured L1 model")
        const available = (await ctx.model.list()).data
        if (!available.some((candidate) => candidate.providerID === model.providerID && candidate.id === model.modelID)) throw new Error(`Unavailable model: ${model.providerID}/${model.modelID}`)
        const decision = await decideTask({
          instruction: "Reply with exactly GOAT_MODEL_ONLY_OK.",
          outcome: "Return the synthetic confirmation string.",
          acceptanceCriteria: ["Response contains GOAT_MODEL_ONLY_OK."],
          tier: "L1",
          config,
          availableModels: available.map((candidate) => ({ providerID: candidate.providerID, modelID: candidate.id })),
        })
        const task = decision.tasks[0]
        const routing = decision.decisions[0]
        const prompt = decision.prompts[0]
        if (!task || !routing || !routing.model || !prompt) throw new Error("Model-only POC planning failed")
        modelOnlyState = "running"
        const startedAt = Date.now()
        const generation = ctx.experimental.generate.text({ model: { providerID: routing.model.providerID, id: routing.model.modelID }, prompt: prompt.text })
        const result = await Promise.race([
          generation,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Model-only POC local wait budget exhausted; provider request may still be running")), 30_000)),
        ]).catch((error: unknown) => {
          modelOnlyState = "timed_out"
          throw error
        })
        modelOnlyState = "spent"
        return {
          status: "completed",
          intentID: decision.intent.id,
          taskID: task.id,
          tier: routing.tier,
          model: { providerID: routing.model.providerID, modelID: routing.model.modelID },
          result: result.text,
          elapsedMs: Date.now() - startedAt,
        }
      },
    })
  },
})

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
