import type { Plugin } from "@opencode/plugin"
import { decideTask, defaults, denyAllRuntimePolicy, digest, executePlan, projectSnapshot, ProjectFileRefusal,
  RoleBudget, runtimeEligibility, validateConfig, type ModelRef, type TaskState } from "@goat/core"
import { installConversation, wireModel } from "./conversation.js"
import { loadTask, provision, type Workspace } from "./coding.js"
import { authorizedProject, provisionProject, syncProject, type ProjectTask } from "./project.js"
import { openTrace } from "./trace.js"
import { installWorkspace } from "./workspace.js"
import { access, writeFile } from "node:fs/promises"
import { isDeepStrictEqual } from "node:util"

const deny = [{ action: "*", resource: "*", effect: "deny" }] as const
const agent = "goat-local-text"
const budget = { maxModelRequests: 4, maxDurationMs: 8000, maxWorkerRetries: 1, maxAuditorRetries: 1, maxExecutionDepth: 1 }
type DispatchRequest = { instruction: string; sessionID: string; capability: string; tier?: "L1" | "L2" | "L3" }
type FileOutcome = { input: unknown; status: "completed" | "error" }

export async function textRuntime(ctx: Plugin.Context) {
  // Process-provisioned capability for a disposable host; project storage,
  // caller-supplied paths and /goat on cannot activate this profile.
  const { GOAT_TEXT_PROJECT: provisioned, GOAT_TEXT_CAPABILITY: capability, GOAT_TEXT_PROVIDER: endpoint } = process.env
  const project = provisioned ?? ctx.location?.directory
  const local = !!provisioned && project === ctx.location?.directory && !!capability && capability.length >= 32 &&
    !!endpoint && /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/v1$/.test(endpoint)
  const signed = !!provisioned && project === ctx.location?.directory && !!capability && capability.length >= 32 &&
    !endpoint && ["coding", "project"].includes(process.env.GOAT_LIVE_PROFILE ?? "") && !!process.env.GOAT_CODE_MANIFEST
  const ordinary = !provisioned && !!ctx.location
  const live = signed || ordinary
  const multi = ordinary || signed && process.env.GOAT_LIVE_PROFILE === "project"
  const manifest = process.env.GOAT_CODE_MANIFEST!
  const task = live && !multi ? await loadTask(manifest) : undefined
  let trace = multi && !ordinary ? openTrace() : undefined
  // For ordinary children use only the assignment and actual snapshot tool
  // results. Narrow native context before the selected adapter serializes it.
  const outgoing = new Map<string,{ prompt:string; auditor:boolean; operations:{args:unknown; content:string}[] }>()
  let busy = false
  let controller: AbortController | undefined
  const permits = new Map<string, { left: number; reserve(): number } | null>()
  const wire = new Map<string, (string | null)[]>()
  const fileTool = "goat_task_file"
  type Files = Workspace | Awaited<ReturnType<typeof provisionProject>>
  type Broker = Pick<Awaited<ReturnType<typeof provisionProject>>, "read" | "replace">
  const grants = new Map<string, { id: string; ws: Broker; readOnly: boolean; tail: Promise<void>; signal: AbortSignal; left: number;
    files?: ProjectTask["files"]; outcomes?: Map<string, FileOutcome> }>()
  let progress: { status: string; tasks: { taskId: string; objective: string; dependsOn: string[]; state: string;
    tier: string; model: ModelRef | null; attempt: number; sessionID?: string }[] } | undefined
  const bindings = new Map<string, (ref?: { providerID: string; id: string }) => Promise<void>>()
  const pendingPrompts = new Map<string, string>()
  let parent: { id: string; user?: string; conversational: boolean; signal: AbortSignal } | undefined
  async function checkBinding(id: string, ref?: { providerID: string; id: string }) {
    const check = bindings.get(id)
    if (check) await check(ref)
    else if (multi && (await ctx.session.get({ sessionID: id })).metadata?.goatRole) throw Error("Expired role binding")
  }
  if (live) {
    if (multi) await ctx.session.hook("prompt", async e => {
      if (!bindings.has(e.sessionID)) { await checkBinding(e.sessionID); return }
      if (pendingPrompts.get(e.sessionID) !== e.prompt.text || e.prompt.files?.length || e.prompt.agents?.length || e.prompt.skills?.length) {
        trace!.record("prompt-denied", { id: e.sessionID })
        throw Error("Outside assigned prompt")
      }
      pendingPrompts.delete(e.sessionID)
    })
    await ctx.tool.transform(editor => editor.add({
      name: fileTool, description: multi ? "Read an assigned file by its exact relative path. Workers may replace or create assigned editable files." : "Read the assigned file, or replace its entire contents. No paths or commands.",
      options: { codemode: false, permission: fileTool },
      input: { type: "object", properties: { action: { enum: ["read", "replace"] }, ...(multi && { path: { type: "string" } }), source: { type: "string", maxLength: multi ? 16384 : 8192 } },
        required: ["action"], additionalProperties: false },
      async execute(input, call) {
        const g = grants.get(call.sessionID)
        if (!g || call.sessionID !== g.id || call.agent !== (ordinary ? "build" : g.readOnly ? "goat-project-auditor" : "goat-code-worker") || g.signal.aborted ||
          call.signal.aborted) throw Error("No task file capability")
        const exhausted = g.left <= 0
        if (!exhausted) g.left--
        const key = `${call.messageID}:${call.id}`
        const previous = g.tail
        let release!: () => void
        g.tail = new Promise(resolve => { release = resolve })
        try {
          await previous
          if (grants.get(g.id) !== g) throw Error("Expired file capability")
          if (!validateConfig(await ctx.storage.get("config")).enabled) throw Error("GOAT is off")
          await checkBinding(g.id)
          g.signal.throwIfAborted(); call.signal.throwIfAborted()
          const { action, source, path } = input as { action: string; source?: string; path?: string }
          if (exhausted) {
            if (action === "read" && g.files?.some(f => f.path === path)) {
              // A batch can exhaust either role's quota before the tool is hidden.
              g.outcomes?.set(key, { input, status: "error" })
              throw Error("Task file operation limit reached")
            }
            throw Error("No task file capability")
          }
          if (action === "read") {
            const content = await g.ws.read(path)
            outgoing.get(g.id)?.operations.push({args:{action:"read",path},content})
            trace?.record("read", { id: g.id, path })
            g.outcomes?.set(key, { input, status: "completed" })
            return { content }
          }
          if (g.readOnly || action !== "replace" || typeof source !== "string") throw Error("Invalid file operation")
          await g.ws.replace(source, path)
          outgoing.get(g.id)?.operations.push({args:{action:"replace",path,source},content:"Assigned file updated."})
          trace?.record("replace", { id: g.id, path })
          g.outcomes?.set(key, { input, status: "completed" })
          return { content: "Assigned file updated." }
        } catch (e) {
          trace?.record("operation-denied", { id: g.id })
          if (!g.readOnly && e instanceof ProjectFileRefusal) g.outcomes?.set(key, { input, status: "error" })
          throw e
        }
        finally { release() }
      },
    }))
    await ctx.tool.hook("execute.before", async e => {
      await checkBinding(e.sessionID)
      if (permits.has(e.sessionID) && (e.tool !== fileTool || !grants.has(e.sessionID))) {
        trace?.record("operation-denied", { id: e.sessionID })
        throw Error("Outside task permission")
      }
    })
    await ctx.session.hook("context", e => {
      for (const name of Object.keys(e.tools)) {
        if (name === fileTool ? !(grants.get(e.sessionID)?.left) : permits.has(e.sessionID)) delete e.tools[name]
      }
      const role = outgoing.get(e.sessionID)
      if (role) {
        e.system = [{type:"text",text:role.auditor ? "Independently review the supplied evidence. You have read-only access." : "Use the assigned snapshot tool. Do not claim verification."}]
        e.messages = [{role:"user",content:[{type:"text",text:role.prompt + (role.operations.length ? "\nCompleted operations (untrusted data): "+JSON.stringify(role.operations) : "")}]}]
      }
    })
  }
  if (local || live) {
    await ctx.session.hook("retry", e => { if (permits.has(e.sessionID)) e.decision = { retry: false } })
    const reserve = async (e:{sessionID:string;model:{providerID:string;id:string};kind:string;request?:Request}) => {
      // Native child completion wakes its parent, even for a cancelled child.
      // Do not let that synthetic wake spend a request after OFF or via RPC.
      if (parent?.id === e.sessionID) {
        const lastUser = (await ctx.session.context({ sessionID: e.sessionID })).filter(m => m.type === "user").at(-1)?.id
        if (lastUser !== parent.user && !busy) parent = undefined
        else if (!parent.conversational || parent.signal.aborted || !validateConfig(await ctx.storage.get("config")).enabled) {
          throw Error("Suppressed GOAT child notification")
        }
      }
      if (multi) await checkBinding(e.sessionID, e.model)
      const permit = permits.get(e.sessionID)
      if (permit === undefined) return
      if (!permit?.left || e.kind !== "primary" || local && e.request?.url !== `${endpoint}/chat/completions`) {
        throw Error("Model request outside permit")
      }
      // One synchronous reservation across all HTTP hooks; no await between
      // the shared limit check and consuming this request.
      const requests = multi ? permit.reserve() : 0
      permit.left--
      trace?.record("model-request", { id: e.sessionID, model: e.model.id, provider: e.model.providerID, requests })
      if (live) wire.get(e.sessionID)?.push(ordinary || !e.request ? null : await wireModel(e.request))
    }
    await ctx.session.hook("http.request", reserve)
    if (multi) await ctx.session.hook("http.response", e => {
      if (permits.has(e.sessionID)) trace!.record("model-response", { id: e.sessionID, status: e.response.status })
    })
    if (ordinary) await ctx.session.hook("experimental.ws.handshake",reserve)
    else if (live) await ctx.session.hook("experimental.ws.handshake", async e => {
      if (permits.has(e.sessionID) || e.agent === "build" && validateConfig(await ctx.storage.get("config")).enabled) throw Error("Coding profile requires HTTP session requests")
    })
  }
  const dispatch = async (input: unknown, caller: AbortSignal, primaryModel?: ModelRef, managerSteps?: string[],
    native?: {task: ProjectTask; current:()=>Promise<void>}) => {
    const config = validateConfig(await ctx.storage.get("config") ?? defaults)
    if (!config.enabled) return { status: "bypassed", reason: "off" }
    const req = input as DispatchRequest
    if (ordinary ? !native : !(local || signed) || req.capability !== capability) {
      trace?.record("authorization-denied")
      return { status: "blocked", reason: "unauthorized" }
    }
    if (busy) { trace?.record("busy"); return { status: "blocked", reason: "busy" } }
    busy = true
    if (ordinary) trace = openTrace()
    progress = undefined
    const ids: Partial<Record<"worker" | "auditor", string>> = {}
    const states: TaskState[] = ["queued", "classifying"]
    let turns = 0, output = "", quarantined = false
    let ws: Files | undefined, assignment: ProjectTask | undefined, review: unknown
    let evidence: Awaited<ReturnType<Files["inspect"]>> | undefined
    const roles = new Map<string, "worker" | "auditor">()
    const deadline = AbortSignal.timeout(multi ? 300000 : live ? 180000 : budget.maxDurationMs)
    controller = new AbortController()
    const external = AbortSignal.any([caller, deadline, controller.signal])
    const workerFailure = new AbortController()
    const signal = AbortSignal.any([external, workerFailure.signal])
    let roleBudget = new RoleBudget(multi ? 48 : budget.maxModelRequests)
    let unresponsive = false
    const execute = async () => {
    try {
      signal.throwIfAborted()
      const source = await ctx.session.get({ sessionID: req.sessionID })
      if (source.location.directory !== project || source.parentID || source.metadata?.goatRole) throw Error("Invalid source session or execution depth")
      if (multi) {
        try { assignment = native?.task ?? await authorizedProject(manifest, project!, req.instruction) }
        catch (e) { trace!.record("authorization-denied"); throw e }
      }
      const schedule = assignment?.schedule
      if (schedule?.maxRequests !== undefined) roleBudget = new RoleBudget(schedule.maxRequests)
      const integrated = assignment?.files.map(f => ({ ...f }))
      const disk = assignment?.files.map(f => ({ ...f }))
      if (task && req.instruction !== task.instruction) throw Error("Instruction outside provisioned task")
      const models = (await ctx.model.list()).data.filter(m => m.enabled && (live || m.providerID === "fixture"))
      const availableModels = models.map(m => ({ providerID: m.providerID, modelID: m.id, tools: m.capabilities.tools }))
      const manager = config.inheritManagerModel
        ? primaryModel ?? (source.model && { providerID: source.model.providerID, modelID: source.model.id })
        : config.models.manager
      if (primaryModel && (primaryModel.providerID !== manager?.providerID || primaryModel.modelID !== manager?.modelID)) {
        throw Error("Manager assignment changed during conversation turn")
      }
      const match = /^Convert the word ([a-zA-Z]{1,80}) to (upper|lower)case\.$/.exec(req.instruction)
      const literal = /^Reply with exactly "([^"\r\n]{1,512})"\.$/.exec(req.instruction)
      const expected = match ? (match[2] === "upper" ? match[1].toUpperCase() : match[1].toLowerCase()) : literal?.[1]
      const criterion = assignment ? "Fulfil the original objective with only authorized changes, passing all assigned test suites and independent risk review." : task ? `Correct ${task.function} in ${task.filename}; all provisioned cases pass with a verified file change.` : match ? `The entire answer is the ${match[2]}case word, with no extra text.` :
        literal ? "The entire answer is the quoted text, with no quotation marks or extra text." : undefined
      const plan = await decideTask({ instruction: req.instruction, config, availableModels, tier: req.tier,
        ...(assignment && managerSteps && { reasoner: { planSteps: () => managerSteps } }),
        assignments: schedule?.tasks, userPlan: assignment?.userPlan, ...(criterion && { acceptanceCriteria: [criterion] }) })
      if (plan.readiness !== "ready" || plan.tasks.length > (multi ? 4 : 1)) throw Error("needs_review")
      if ((!live && !expected) || !criterion || plan.verification[0].criteria[0] !== criterion) throw Error("No deterministic verifier")
      const route = plan.decisions[0], worker = route.model, auditor = config.models.auditor
      const eligible = runtimeEligibility(plan, plan.tasks[0], denyAllRuntimePolicy, budget)
      if (!eligible.allowed) throw Error(eligible.reason)
      if (!manager || !worker || !auditor || worker.modelID === auditor.modelID && worker.providerID === auditor.providerID) throw Error("Missing or non-independent role assignment")
      const provider = local ? (await ctx.provider.get({ providerID: "fixture" })).data : undefined
      if (provider && (provider.package !== "@opencode/ai/providers/openai-compatible" || provider.settings?.baseURL !== endpoint) ||
          !ordinary && (await ctx.agent.get({ agentID: agent })).data.steps !== 1) throw Error("Invalid execution profile")
      for (const ref of [manager, auditor, ...plan.decisions.map(d => d.model)]) {
        if (!ref || ref !== auditor && ref !== manager && ref.modelID === auditor.modelID && ref.providerID === auditor.providerID) throw Error("Non-independent assignment")
        const m = models.find(m => m.providerID === ref.providerID && m.id === ref.modelID)
        if (!m || provider && ((m.package && m.package !== provider.package) || (m.settings?.baseURL ?? endpoint) !== endpoint) ||
          live && ref !== auditor && !m.capabilities.tools) throw Error(`Unavailable or incompatible role model: ${ref.providerID}/${ref.modelID}. Select enabled models in /goat router; Manager and Workers need tool support.`)
      }
      if (task) {
        ws = await provision(task, signal)
      }
      if (assignment) {
        if (source.agent !== "build") throw Error("Project Manager must use Build")
        // One signed launch, one execution, also across plugin reload/parallel hosts.
        if (!ordinary) await writeFile(`${manifest}.spent`, plan.intent.id, { flag: "wx", mode: 0o600 })
        const sourceHistory = await ctx.session.context({ sessionID: req.sessionID })
        parent = { id: req.sessionID, user: sourceHistory.filter(m => m.type === "user").at(-1)?.id, conversational: !!primaryModel, signal }
        trace!.record("authorized", { intent: plan.intent.id, session: req.sessionID })
        trace!.record("budget", { maxRoleRequests: roleBudget.limit, tokenStop: 128000, deadlineMs: 300000, maxRework: 1 })
        ws = await provisionProject(assignment, signal)
        progress = { status: "running", tasks: plan.tasks.map((t,i) => ({ taskId: t.id, objective: t.objective,
          dependsOn: schedule?.tasks[i].dependsOn ?? (i ? [plan.tasks[i-1].id] : []), state: "waiting", attempt: 0,
          tier: plan.decisions[i].tier, model: plan.decisions[i].model })) }
      }
      let lastRoute = route
      const integrations: { taskId: string; sessionID?: string; attempt: number; tier: string; model: ModelRef;
        inputs: { path: string; sha256: string | null }[]; changes: { path: string; sha256: string }[] }[] = []
      async function turn(role: "worker" | "auditor", ref: ModelRef, text: string, i: number, attempt: number, reserve: () => number,
        snapshot?: ReturnType<typeof projectSnapshot>) {
        signal.throwIfAborted()
        if (assignment && Date.now() >= assignment.expires) throw Error("Owner authorization expired")
        if (!validateConfig(await ctx.storage.get("config")).enabled) throw Error("GOAT switched off")
        const write = role === "worker" && (snapshot ?? ws)
        const fileAccess = write || (multi && ws)
        const who = ordinary ? "build" : write ? "goat-code-worker" : multi ? "goat-project-auditor" : agent
        const rules = fileAccess ? [...deny, { action: fileTool, resource: "*", effect: "allow" as const }] : deny
        const taskState = role === "worker" ? progress?.tasks[i] : undefined
        const identity = { ...(taskState && { taskId: taskState.taskId, tier: taskState.tier }), attempt }
        const sessionID = (!multi && ids[role]) || (await ctx.session.create({ title: `GOAT ${role}${taskState ? ` ${taskState.taskId} ${taskState.tier} #${attempt}` : ""}`, agent: who, permissions: rules,
          ...(multi && { parentID: req.sessionID }),
          metadata: { goatRole: role, intentID: plan.intent.id, ...identity }, location: { directory: project! }, model: { providerID: ref.providerID, id: ref.modelID } })).id
        ids[role] = sessionID
        if (taskState) taskState.sessionID = sessionID
        const previous = (await ctx.session.context({ sessionID })).length
        roles.set(sessionID, role)
        const steps = (await ctx.agent.get({ agentID: who })).data.steps
        if (!ordinary && (multi ? steps !== (write ? 24 : 6) : write ? steps !== 3 && steps !== 5 : steps !== 1)) throw Error("Invalid role step limit")
        let invalid = false
        async function assertProfile(wireRef?: { providerID: string; id: string }) {
          await native?.current()
          const info = await ctx.session.get({ sessionID })
          if (invalid || wireRef && (wireRef.providerID !== ref.providerID || wireRef.id !== ref.modelID) ||
            info.location.directory !== project || info.parentID !== (multi ? req.sessionID : undefined) || info.agent !== who || info.model?.id !== ref.modelID ||
            info.model.providerID !== ref.providerID || info.permissions?.length !== rules.length || !info.permissions.every((p,i) =>
              p.effect === rules[i].effect && p.action === rules[i].action && p.resource === "*") ||
              multi && (await ctx.agent.get({ agentID: who })).data.steps !== steps) {
            invalid = true; trace?.record("binding-denied", { sessionID }); throw Error("Session profile mismatch")
          }
          if (multi) {
            if (Date.now() >= assignment!.expires) throw Error("Owner authorization expired")
            try {
              roleBudget.observe(sessionID, info.tokens.input + info.tokens.output + info.tokens.reasoning + info.tokens.cache.read + info.tokens.cache.write)
            } catch (error) { trace!.record("budget-exceeded", { observed: roleBudget.observedTokens }); throw error }
            signal.throwIfAborted()
            if (JSON.stringify(validateConfig(await ctx.storage.get("config"))) !== JSON.stringify(config)) {
              invalid = true; throw Error("GOAT configuration changed")
            }
            signal.throwIfAborted()
          }
        }
        await assertProfile()
        bindings.set(sessionID, assertProfile)
        trace?.record("dispatch", { sessionID, role, parent: req.sessionID, model: ref, ...identity })
        signal.throwIfAborted()
        const files = snapshot?.files ?? assignment?.files
        const cap = multi ? write ? Math.min(22, 3 + files!.length * 2) : 4 : write ? 3 : 1
        const permit = { left: cap, reserve }
        permits.set(sessionID, permit)
        if (live && !wire.has(sessionID)) wire.set(sessionID, [])
        const outcomes = multi ? new Map<string, FileOutcome>() : undefined
        if (fileAccess) {
          grants.set(sessionID, { id: sessionID, ws: fileAccess, readOnly: !write, tail: Promise.resolve(), left: cap - 1, signal, files, outcomes })
          const scope = `Assigned files: ${files?.map(f => `${f.path} (${f.role}${f.source === null ? ", new" : ""})`).join(", ")}. Use ${fileTool} with action, path and (for replace) source.`
          if (multi) text = (write ? `${text}\n${scope}\nMake scoped edits. The host runs protected unittest suites after the changes.` : `${scope} You can read evidence files only.\n${text}`)
          else text += `\nUse ${fileTool} to read ${task!.filename}, then replace its entire Python source. No imports requiring filesystem access. Return a brief change summary.`
        }
        if (!multi) reserve() // Private single-task profiles meter turns.
        turns++
        if (ordinary) outgoing.set(sessionID,{prompt:text,auditor:role === "auditor",operations:[]})
        if (multi) pendingPrompts.set(sessionID, text)
        try {
          // Promise-plugin session methods in 2.3.2 do not forward AbortSignal.
          let abort!: () => void
          try {
            await Promise.race([ctx.session.prompt({ sessionID, text }).then(() => ctx.session.wait({ sessionID })), new Promise<never>((_, reject) => {
              abort = () => reject(Error("interrupted"))
              signal.addEventListener("abort", abort, { once: true })
              if (signal.aborted) abort()
            })])
          } finally { signal.removeEventListener("abort", abort) }
          signal.throwIfAborted()
        } catch (error) {
          permit.left = 0
          grants.delete(sessionID)
          // Keep the lock if the native execution cannot be drained.
          trace?.record("cancel", { sessionID })
          let timer: ReturnType<typeof setTimeout> | undefined
          try {
            await Promise.race([ctx.session.interrupt({ sessionID }).then(() => ctx.session.wait({ sessionID })), new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(Error("Session cleanup timed out; host quarantined")), 3000)
            })])
          } catch (cleanupError) { quarantined = true; throw cleanupError }
          finally { clearTimeout(timer) }
          if (signal.aborted) return undefined
          throw error
        }
        grants.delete(sessionID)
        await assertProfile()
        if (permit.left === cap || (await ctx.session.get({ sessionID })).outcome !== "succeeded") throw Error("Unverified native turn")
        permit.left = 0
        const round = (await ctx.session.context({ sessionID })).slice(previous)
        const prompts = round.filter(m => m.type === "user")
        if (prompts.length !== 1 || prompts[0].text !== text || round.some(m => m.type === "synthetic")) throw Error("Unexpected session input")
        const answers = round.filter(m => m.type === "assistant")
        const last = answers.at(-1)
        if (!last) throw Error("Missing assistant response")
        if (answers.length > cap) throw Error("Assistant response count exceeds turn limit")
        for (const answer of answers) {
          if (answer.model.id !== ref.modelID || answer.model.providerID !== ref.providerID) throw Error("Assistant model/provider mismatch")
          for (const part of answer.content) {
            if (part.type === "text" || live && part.type === "reasoning") continue
            if (part.type !== "tool") throw Error("Unexpected assistant content type")
            if (!fileAccess || part.name !== fileTool) throw Error("Unexpected assistant tool")
            const state = part.state
            if (state.status !== "completed" && !(outcomes && state.status === "error")) throw Error("Unexpected file tool state")
            if (outcomes) {
              const key = `${answer.id}:${part.id}`
              const broker = outcomes.get(key)
              if (!broker || broker.status !== state.status || !isDeepStrictEqual(broker.input, state.input)) {
                throw Error("File tool result not confirmed by broker")
              }
              outcomes.delete(key)
            }
          }
        }
        if (outcomes?.size) throw Error("Assistant response missing brokered file operation")
        if (last.finish !== "stop") throw Error("Final assistant finish reason is not stop")
        const result = last.content.filter(p => p.type === "text").map(p => p.text).join("")
        if (!result || result.length > 8192) throw Error("Invalid text evidence")
        signal.throwIfAborted()
        if (role === "worker") output = result
        return result
      }
      let reason = await executePlan(plan, {
        states, budget: roleBudget, rework: true, models: config.models,
        verification: assignment ? { kind: "project", project: assignment } : task ? { kind: "cases" } : { kind: "text", expected: expected! },
      }, {
        signal, inventory: availableModels, auditContext: () => ({ schedule, integrations, traceHead: trace?.head,
          requests: [...roles].map(([sessionID,role]) => ({ sessionID, role, models: wire.get(sessionID) })) }),
        interruptWorkers: () => workerFailure.abort(),
        onFindings: value => { review = value },
        verification: ws ? { suiteResource: suite => suite.replaceAll(".", "/") + ".py", inspect: async () => {
          if (progress) progress.status = "verifying"
          if (schedule) await syncProject(ws!, disk!, integrated!, signal, assignment!.expires)
          evidence = await ws!.inspect()
          trace?.record("checks", { sha256: evidence.sha256, passed: evidence.passed })
          return evidence
        } } : null,
        audit: ({ text, model, attempt, reserve }) => turn("auditor", model, text, 0, attempt, reserve),
        runWorker: async ({ text, index: i, attempt, model: selected, tier, scope, reserve }) => {
          const d = plan.decisions[i]
          lastRoute = { ...d, model: selected, tier }
          const taskState = progress?.tasks[i]
          if (taskState) Object.assign(taskState, { state: "active", attempt, tier, model: selected })
          if (progress) progress.status = attempt === 2 ? "rework" : "running"
          const snapshot = scope && projectSnapshot(integrated!, scope)
          try {
            const report = await turn("worker", selected, text, i, attempt, reserve, snapshot)
            if (report !== undefined && snapshot) {
              const changes = snapshot.commit(attempt === 1)
              const record = { taskId: d.taskId, attempt, tier, model: selected, sessionID: taskState?.sessionID,
                inputs: snapshot.files.map(f => ({ path: f.path, sha256: f.source === null ? null : digest(f.source) })), changes }
              integrations.push(record)
              trace!.record("integrated", record)
            }
            if (taskState) taskState.state = report === undefined ? "cancelled" : "integrated"
            return report
          } catch (e) { if (taskState) taskState.state = "failed"; throw e }
        } })
      if (ordinary && evidence && !evidence.results.length &&
          ["insufficient-evidence","unreproduced-or-out-of-scope","rejected"].includes(reason)) reason = "unsupported_verification"
      if (reason === "accepted" && schedule) {
        await syncProject(ws!, disk!, integrated!, signal, assignment!.expires)
      }
      const status = deadline.aborted && live ? "timed_out" : states.at(-1)
      if (progress) progress.status = status ?? "failed"
      trace?.record("terminal", { status, reason, turns, requests: roleBudget.requests, states })
      if (live && evidence && reason === "accepted") {
        const detail = "changes" in evidence ? ` (${evidence.results.reduce((sum, r) => sum + r.count, 0)} tests; ${evidence.changes.map(f => f.path).join(", ")})` : ""
        output = `Verified: ${evidence.results.length}/${evidence.results.length} ${multi ? "unittest suites" : "function cases"} passed${detail}. SHA-256: ${evidence.sha256}. Result: ${ws!.path}`
      }
      return { status, reason, states, ids, turns, intentID: plan.intent.id, manager, route: lastRoute, auditor,
        ...(schedule && { workers: integrations }),
        ...(multi && { ...(review !== undefined && { review }), trace: { path: trace!.path, head: trace!.head }, observedTokens: roleBudget.observedTokens }),
        ...(ws && { workspaceFile: ws.path, ...(evidence && { evidence }), requests: Object.fromEntries(["worker","auditor"].map(role =>
          [role, [...roles].filter(([, r]) => r === role).flatMap(([id]) => wire.get(id) ?? [])])) }),
        ...(reason === "accepted" && { output }) }
    } catch (error) {
      const status = quarantined ? "failed" : live && deadline.aborted ? "timed_out" : external.aborted ? "cancelled" : "failed"
      const reason = quarantined ? "Session cleanup failed; host quarantined" : error instanceof Error ? error.message : "host failure"
      if (progress) progress.status = status
      trace?.record(external.aborted ? "cancel" : "error", { status, turns, requests: roleBudget.requests })
      states.push(status === "cancelled" ? "cancelled" : "failed")
      return { status, reason, states, ids, turns, ...(trace && { trace: { path: trace.path, head: trace.head } }) }
    } finally {
      for (const task of progress?.tasks ?? []) if (task.state === "waiting") task.state = "blocked"
      grants.clear()
      outgoing.clear()
      await ws?.close()
      if (!quarantined && !unresponsive) {
        for (const id of roles.keys()) { permits.delete(id); wire.delete(id); bindings.delete(id); pendingPrompts.delete(id) }
        controller = undefined
        busy = false
      }
    }
    }
    // A local SDK call (including session creation or cleanup) need not
    // observe AbortSignal. Bound the caller's wait and retain the lock in
    // that case; a late result can never start a replacement Worker.
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort!: () => void
    const stopped = new Promise<{ status: string; reason: string }>(resolve => {
      onAbort = () => {
        timer = setTimeout(() => {
          unresponsive = true
          grants.clear()
          for (const id of roles.keys()) permits.set(id, null)
          trace?.record("quarantine", { reason: "host unresponsive after interrupt" })
          resolve({ status: deadline.aborted ? "timed_out" : external.aborted ? "cancelled" : "failed", reason: "Host unresponsive; private host quarantined" })
        }, 3500)
      }
      signal.addEventListener("abort", onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
    try { return await Promise.race([execute(), stopped]) }
    finally { clearTimeout(timer); signal.removeEventListener("abort", onAbort) }
  }
  if ((local || signed) && process.env.GOAT_TEXT_CONVERSATION === "1") {
    await installConversation(ctx, project!, endpoint, (sessionID, instruction, signal, model, steps) =>
      dispatch({ sessionID, instruction, capability }, signal, model, steps), multi ? async instruction => {
        try {
          await authorizedProject(manifest, project!, instruction)
          try { await access(`${manifest}.spent`); throw Error("Owner grant spent") }
          catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e }
        } catch (e) { trace!.record("authorization-denied"); throw e }
      } : undefined)
  }
  const workspace = ordinary ? await installWorkspace(ctx,(task,sessionID,model,signal,current) =>
    dispatch({sessionID,instruction:task.instruction},signal,model,undefined,{task,current})) : undefined
  return Object.assign(dispatch, { cancel: () => { controller?.abort(); workspace?.cancel() }, status: () => workspace?.status() ?? progress, workspace: !!workspace })
}
