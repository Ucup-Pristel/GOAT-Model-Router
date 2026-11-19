import { Plugin } from "@opencode/plugin"
import { defaults, modelStatus, validateConfig, type GoatConfig } from "@goat/core"
import { Goat } from "@goat/opencode/rpc"

export default Plugin.define({
  id: "goat.model-router",
  async setup(ctx) {
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
          return { text: `GOAT ${verb.toUpperCase()}. Orchestration execution remains unimplemented.` }
        }
        if (verb === "mode") {
          const mode = args[0]
          if (mode !== "standard" && mode !== "resink") return { text: "Usage: /goat mode standard|resink" }
          config = { ...config, mode }
          await ctx.storage.set("config", config)
          return { text: `GOAT mode: ${mode}. Planner execution remains unimplemented.` }
        }
        if (verb === "status") {
          const available = (await ctx.model.list()).data.map((model) => ({ providerID: model.providerID, modelID: model.id }))
          return { text: `Enabled: ${config.enabled}\nMode: ${config.mode}\nManager: ${config.inheritManagerModel ? "inherit session model" : modelStatus(config.models.manager, available)}\nL1: ${modelStatus(config.models.l1, available)}\nL2: ${modelStatus(config.models.l2, available)}\nL3: ${modelStatus(config.models.l3, available)}\nAuditor: ${modelStatus(config.models.auditor, available)}\nOrchestration: not implemented` }
        }
        if (verb === "router") {
          return { text: "Use the interactive /goat router menu to configure models." }
        }
        return { text: "Usage: /goat router|mode|on|off|status" }
      },
    })
  },
})

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
