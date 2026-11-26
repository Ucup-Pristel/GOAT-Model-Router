import type { Plugin } from "@opencode/plugin"
import { decideTask, defaults, denyAllRuntimePolicy, runtimeEligibility, validateConfig, type ModelRef, type TaskState } from "@goat/core"
import { verifiedText } from "./verified-text.js"
import { installConversation, wireModel } from "./conversation.js"
import { loadTask, provision, type Workspace } from "./coding.js"

const deny = [{ action: "*", resource: "*", effect: "deny" }] as const
const agent = "goat-local-text"
const budget = { maxModelRequests: 4, maxDurationMs: 8000, maxWorkerRetries: 1, maxAuditorRetries: 1, maxExecutionDepth: 1 }
type Request = { instruction: string; sessionID: string; capability: string; tier?: "L1" | "L2" | "L3" }

export async function textRuntime(ctx: Plugin.Context) {
  // Process-provisioned capability for a disposable host; project storage,
  // caller-supplied paths and /goat on cannot activate this profile.
  const { GOAT_TEXT_PROJECT: project, GOAT_TEXT_CAPABILITY: capability, GOAT_TEXT_PROVIDER: endpoint } = process.env
  const local = !!project && project === ctx.location?.directory && !!capability && capability.length >= 32 &&
    !!endpoint && /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/v1$/.test(endpoint)
  const live = !!project && project === ctx.location?.directory && !!capability && capability.length >= 32 &&
    !endpoint && process.env.GOAT_LIVE_PROFILE === "coding" && !!process.env.GOAT_CODE_MANIFEST
  const task = live ? await loadTask(process.env.GOAT_CODE_MANIFEST!) : undefined
  let busy = false
  const permits = new Map<string, number>()
  const wire = new Map<string, (string | null)[]>()
  const fileTool = "goat_task_file"
  let grant: { id: string; ws: Workspace; writing: boolean; signal: AbortSignal; left: number } | undefined
  if (live) {
    await ctx.tool.transform(editor => editor.add({
      name: fileTool, description: "Read the assigned file, or replace its entire contents. No paths or commands.",
      options: { codemode: false, permission: fileTool },
      input: { type: "object", properties: { action: { enum: ["read", "replace"] }, source: { type: "string", maxLength: 8192 } },
        required: ["action"], additionalProperties: false },
      async execute(input, call) {
        const g = grant
        if (!g || call.sessionID !== g.id || call.agent !== "goat-code-worker" || g.signal.aborted ||
          call.signal.aborted || g.writing || g.left-- <= 0) throw Error("No task file capability")
        g.writing = true
        try {
          if (!validateConfig(await ctx.storage.get("config")).enabled) throw Error("GOAT is off")
          g.signal.throwIfAborted()
          const { action, source } = input as { action: string; source?: string }
          if (action === "read") return { content: await g.ws.read() }
          if (action !== "replace" || typeof source !== "string") throw Error("Invalid file operation")
          await g.ws.replace(source)
          return { content: "Assigned file updated." }
        } finally { g.writing = false }
      },
    }))
    await ctx.tool.hook("execute.before", e => {
      if (permits.has(e.sessionID) && (e.tool !== fileTool || grant?.id !== e.sessionID)) throw Error("Outside task permission")
    })
    await ctx.session.hook("context", e => {
      for (const name of Object.keys(e.tools)) {
        if (name === fileTool ? grant?.id !== e.sessionID || grant.left <= 0 : permits.has(e.sessionID)) delete e.tools[name]
      }
    })
  }
  if (local || live) {
    await ctx.session.hook("retry", e => { if (permits.has(e.sessionID)) e.decision = { retry: false } })
    await ctx.session.hook("http.request", async e => {
      if (!permits.has(e.sessionID)) return
      if (!permits.get(e.sessionID) || e.kind !== "primary" || local && e.request.url !== `${endpoint}/chat/completions`) {
        throw Error("Model request outside permit")
      }
      permits.set(e.sessionID, permits.get(e.sessionID)! - 1)
      if (live) wire.get(e.sessionID)?.push(await wireModel(e.request))
    })
    if (live) await ctx.session.hook("experimental.ws.handshake", async e => {
      if (permits.has(e.sessionID) || e.agent === "build" && validateConfig(await ctx.storage.get("config")).enabled) throw Error("Coding profile requires HTTP session requests")
    })
  }
  const dispatch = async (input: unknown, caller: AbortSignal, primaryModel?: ModelRef) => {
    const config = validateConfig(await ctx.storage.get("config") ?? defaults)
    if (!config.enabled) return { status: "bypassed", reason: "off" }
    const req = input as Request
    if (!(local || live) || req.capability !== capability) return { status: "blocked", reason: "unauthorized" }
    if (busy) return { status: "blocked", reason: "busy" }
    busy = true
    const ids: Partial<Record<"worker" | "auditor", string>> = {}
    const states: TaskState[] = ["queued", "classifying"]
    let turns = 0, output = "", quarantined = false
    let ws: Workspace | undefined
    let evidence: Awaited<ReturnType<Workspace["inspect"]>> | undefined
    try {
      const signal = AbortSignal.any([caller, AbortSignal.timeout(live ? 180000 : budget.maxDurationMs)])
      signal.throwIfAborted()
      const source = await ctx.session.get({ sessionID: req.sessionID })
      if (source.location.directory !== project || source.parentID || source.metadata?.goatRole) throw Error("Invalid source session")
      if (task && req.instruction !== task.instruction) throw Error("Instruction outside provisioned task")
      const models = (await ctx.model.list()).data.filter(m => m.enabled && (live || m.providerID === "fixture"))
      const availableModels = models.map(m => ({ providerID: m.providerID, modelID: m.id }))
      const manager = config.inheritManagerModel
        ? primaryModel ?? (source.model && { providerID: source.model.providerID, modelID: source.model.id })
        : config.models.manager
      if (primaryModel && (primaryModel.providerID !== manager?.providerID || primaryModel.modelID !== manager?.modelID)) {
        throw Error("Manager assignment changed during conversation turn")
      }
      const match = /^Convert the word ([a-zA-Z]{1,80}) to (upper|lower)case\.$/.exec(req.instruction)
      const literal = /^Reply with exactly "([^"\r\n]{1,512})"\.$/.exec(req.instruction)
      const expected = match ? (match[2] === "upper" ? match[1].toUpperCase() : match[1].toLowerCase()) : literal?.[1]
      const criterion = task ? `Correct ${task.function} in ${task.filename}; all provisioned cases pass with a verified file change.` : match ? `The entire answer is the ${match[2]}case word, with no extra text.` :
        literal ? "The entire answer is the quoted text, with no quotation marks or extra text." : undefined
      const plan = await decideTask({ instruction: req.instruction, config, availableModels, tier: req.tier,
        ...(criterion && { acceptanceCriteria: [criterion] }) })
      if (plan.readiness !== "ready" || plan.tasks.length !== 1) throw Error("needs_review")
      if ((!task && !expected) || !criterion || plan.verification[0].criteria[0] !== criterion) throw Error("No deterministic verifier")
      const route = plan.decisions[0], worker = route.model, auditor = config.models.auditor
      const eligible = runtimeEligibility(plan, plan.tasks[0], denyAllRuntimePolicy, budget)
      if (!eligible.allowed) throw Error(eligible.reason)
      if (!manager || !worker || !auditor || worker.modelID === auditor.modelID && worker.providerID === auditor.providerID) throw Error("Missing or non-independent role assignment")
      const provider = local ? (await ctx.provider.get({ providerID: "fixture" })).data : undefined
      if (provider && (provider.package !== "@opencode/ai/providers/openai-compatible" || provider.settings?.baseURL !== endpoint) ||
          (await ctx.agent.get({ agentID: agent })).data.steps !== 1) throw Error("Invalid execution profile")
      for (const ref of [manager, worker, auditor]) {
        const m = models.find(m => m.providerID === ref.providerID && m.id === ref.modelID)
        if (!m || provider && ((m.package && m.package !== provider.package) || (m.settings?.baseURL ?? endpoint) !== endpoint) ||
          live && ref !== auditor && !m.capabilities.tools) throw Error("Unavailable or incompatible role model")
      }
      if (task) {
        if ((await ctx.agent.get({ agentID: "goat-code-worker" })).data.steps !== 3) throw Error("Invalid Worker step limit")
        ws = await provision(task, signal)
      }
      async function turn(role: "worker" | "auditor", ref: ModelRef, text: string) {
        signal.throwIfAborted()
        if (!validateConfig(await ctx.storage.get("config")).enabled) throw Error("GOAT switched off")
        const write = role === "worker" && ws
        const who = write ? "goat-code-worker" : agent
        const rules = write ? [...deny, { action: fileTool, resource: "*", effect: "allow" as const }] : deny
        const sessionID = ids[role] ??= (await ctx.session.create({ title: `GOAT ${role}`, agent: who, permissions: rules,
          metadata: { goatRole: role, intentID: plan.intent.id }, location: { directory: project! }, model: { providerID: ref.providerID, id: ref.modelID } })).id
        const previous = (await ctx.session.context({ sessionID })).length
        const info = await ctx.session.get({ sessionID })
        if (info.location.directory !== project || info.parentID || info.agent !== who || info.model?.id !== ref.modelID ||
          info.model.providerID !== ref.providerID || info.permissions?.length !== rules.length || !info.permissions.every((p,i) =>
            p.effect === rules[i].effect && p.action === rules[i].action && p.resource === "*")) throw Error("Session profile mismatch")
        signal.throwIfAborted()
        const cap = write ? 3 : 1
        permits.set(sessionID, cap)
        if (live && !wire.has(sessionID)) wire.set(sessionID, [])
        if (write) {
          grant = { id: sessionID, ws: write, writing: false, left: 2, signal }
          text += `\nUse ${fileTool} to read ${task!.filename}, then replace its entire Python source. No imports requiring filesystem access. Return a brief change summary.`
        }
        turns++
        try {
          await ctx.session.prompt({ sessionID, text })
          // Promise-plugin session methods in 2.3.2 do not forward AbortSignal.
          let abort!: () => void
          try {
            await Promise.race([ctx.session.wait({ sessionID }), new Promise<never>((_, reject) => {
              abort = () => reject(Error("interrupted"))
              signal.addEventListener("abort", abort, { once: true })
              if (signal.aborted) abort()
            })])
          } finally { signal.removeEventListener("abort", abort) }
          signal.throwIfAborted()
        } catch (error) {
          permits.set(sessionID, 0)
          // Keep the lock if the native execution cannot be drained.
          quarantined = true
          await ctx.session.interrupt({ sessionID })
          await ctx.session.wait({ sessionID })
          quarantined = false
          if (signal.aborted) return undefined
          throw error
        }
        grant = undefined
        if (permits.get(sessionID) === cap || (await ctx.session.get({ sessionID })).outcome !== "succeeded") throw Error("Unverified native turn")
        permits.set(sessionID, 0)
        const round = (await ctx.session.context({ sessionID })).slice(previous)
        const prompts = round.filter(m => m.type === "user")
        if (prompts.length !== 1 || prompts[0].text !== text || round.some(m => m.type === "synthetic")) throw Error("Unexpected session input")
        const answers = round.filter(m => m.type === "assistant")
        const last = answers.at(-1)
        if (!last || answers.length > cap || !answers.every(a => a.model.id === ref.modelID && a.model.providerID === ref.providerID &&
          a.content.every(p => p.type === "text" || live && p.type === "reasoning" || write && p.type === "tool" && p.name === fileTool && p.state.status === "completed")) ||
          last.finish !== "stop") throw Error("Invalid model response")
        const result = last.content.filter(p => p.type === "text").map(p => p.text).join("")
        if (!result || result.length > 8192) throw Error("Invalid text evidence")
        signal.throwIfAborted()
        if (role === "worker") output = result
        return result
      }
      const reason = await verifiedText(plan, expected ?? "", { states, remaining: () => budget.maxModelRequests - turns,
        ...(ws && { inspect: async () => evidence = await ws!.inspect() }),
        rework: true, turn: (role, text) => turn(role, role === "worker" ? worker : auditor, text) })
      return { status: states.at(-1), reason, states, ids, turns, intentID: plan.intent.id, manager, route, auditor,
        ...(ws && { workspaceFile: ws.path, evidence, requests: { worker: wire.get(ids.worker!), auditor: wire.get(ids.auditor!) } }),
        ...(reason === "accepted" && { output }) }
    } catch (error) {
      states.push("failed")
      return { status: "failed", reason: error instanceof Error ? error.message : "host failure", states, ids, turns }
    } finally {
      grant = undefined
      await ws?.close()
      if (!quarantined) {
        for (const id of Object.values(ids)) { permits.delete(id); wire.delete(id) }
        busy = false
      }
    }
  }
  if ((local || live) && process.env.GOAT_TEXT_CONVERSATION === "1") {
    await installConversation(ctx, project, endpoint, (sessionID, instruction, signal, model) =>
      dispatch({ sessionID, instruction, capability }, signal, model))
  }
  return dispatch
}
