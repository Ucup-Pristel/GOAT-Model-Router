import { Plugin } from "@opencode/plugin"
import { decideTask, defaults, modelStatus, validateConfig } from "@goat/core"
import { Goat } from "./rpc.js"
import { textRuntime } from "./text-runtime.js"
import { workspaceBlock } from "./workspace.js"

export default Plugin.define({
  id: "goat.model-router",
  async setup(ctx) {
    const dispatchText = await textRuntime(ctx)
    let modelOnlyState: "ready" | "running" | "spent" | "timed_out" | "failed" = "ready"
    await ctx.rpc.register(Goat, {
      dispatchText: (input, context) => dispatchText(input, context.signal),
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
          const available = (await ctx.model.list()).data.filter(model => model.enabled !== false)
          for (const model of Object.values(validated.models)) if (model && !available.some((candidate) => candidate.providerID === model.providerID && candidate.id === model.modelID)) throw new Error(`Unavailable model: ${model.providerID}/${model.modelID}. Reopen /goat router and select an enabled model.`)
        }
        await ctx.storage.set("config", validated)
        if (JSON.stringify(previous) !== JSON.stringify(validated)) dispatchText.cancel()
        return { config: validated }
      },
      listModels: async () => {
        const [models, providers] = await Promise.all([ctx.model.list(), ctx.provider.list()])
        return { models: models.data.filter(model => model.enabled !== false).map((model) => ({ providerID: model.providerID, modelID: model.id, name: model.name, providerName: providers.data.find((provider) => provider.id === model.providerID)?.name ?? model.providerID })) }
      },
      command: async (input) => {
        const { input: text } = input as { input: string }
        const [verb, ...args] = text.trim().split(/\s+/)
        let config = validateConfig(await ctx.storage.get("config") ?? defaults)
        if (!["on", "off", "mode", "router", "status"].includes(verb)) return { text: "Usage: /goat router|mode|on|off|status" }
        if (verb === "on" || verb === "off") {
          config = { ...config, enabled: verb === "on" }
          await ctx.storage.set("config", config)
          if (verb === "off") dispatchText.cancel()
          const profile = dispatchText.workspace ? `${workspaceBlock} Use /goat router to assign tool-capable Workers and a different Auditor, then select Standard in /goat mode and send a plain Build prompt.` : "Use the configured private execution profile."
          return { text: verb === "on" ? `GOAT ON. ${profile}` : "GOAT OFF." }
        }
        if (verb === "mode") {
          const mode = args[0]
          if (mode !== "standard" && mode !== "resink") return { text: "Usage: /goat mode standard|resink" }
          config = { ...config, mode }
          dispatchText.cancel()
          await ctx.storage.set("config", config)
          return { text: `GOAT mode: ${mode}.` }
        }
        if (verb === "status") {
          const latest = await ctx.storage.get("lastCodingTurn")
          const progress = dispatchText.status()
          const available = (await ctx.model.list()).data.filter(model => model.enabled !== false).map((model) => ({ providerID: model.providerID, modelID: model.id }))
          const profile = dispatchText.workspace
            ? (config.mode === "standard" ? workspaceBlock : "Select Standard in /goat mode for ordinary workspace edits.")
            : "Private execution profile"
          const activity = dispatchText.workspace && progress
            ? `\nWorkspace: ${progress.status}. See the GOAT tool receipt for checks, applied files and conflicts.`
            : progress ? `\nTask execution: ${JSON.stringify(progress)}` : ""
          return { text: `Enabled: ${config.enabled}\nMode: ${config.mode}\nShared across locations loading GOAT in this OpenCode database.\nManager: ${config.inheritManagerModel ? "inherit session model" : modelStatus(config.models.manager, available)}\nL1: ${modelStatus(config.models.l1, available)}\nL2: ${modelStatus(config.models.l2, available)}\nL3: ${modelStatus(config.models.l3, available)}\nAuditor: ${modelStatus(config.models.auditor, available)}\nOrchestration: ${profile}${activity}${latest ? `\nLast coding turn: ${JSON.stringify(latest)}` : ""}` }
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
        if (process.env.GOAT_LIVE_PROFILE && ctx.location?.directory === process.env.GOAT_TEXT_PROJECT) throw Error("Model-only probe disabled on live profiles")
        const { confirm } = input as { confirm: string }
        if (confirm !== "GOAT_MODEL_ONLY_SYNTHETIC") throw new Error("Model-only POC requires explicit synthetic confirmation")
        if (modelOnlyState !== "ready") throw new Error(`Model-only POC is unavailable: ${modelOnlyState}`)
        modelOnlyState = "running"
        let generating = false
        let timedOut = false
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
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
          generating = true
          const startedAt = Date.now()
          const generation = ctx.experimental.generate.text({ model: { providerID: routing.model.providerID, id: routing.model.modelID }, prompt: prompt.text })
          const result = await Promise.race([
            generation,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                timedOut = true
                reject(new Error("Model-only POC local wait budget exhausted; provider request may still be running"))
              }, 30_000)
            }),
          ])
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
        } catch (error) {
          modelOnlyState = !generating ? "ready" : timedOut ? "timed_out" : "failed"
          throw error
        } finally {
          clearTimeout(timer)
        }
      },
    })
    return () => dispatchText.cancel()
  },
})

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
