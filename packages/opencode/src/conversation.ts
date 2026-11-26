import { Model, type Plugin } from "@opencode/plugin"
import { validateConfig, type ModelRef } from "@goat/core"

const tool = "goat_verify_text"
// Some protocols encode the model in the URL or translate it server-side.
// Only retain the explicit JSON model ID, never credentials, URLs or prompts.
export async function wireModel(request: Request): Promise<string | null> {
  try {
    const { model } = await request.clone().json()
    return typeof model === "string" && model.length <= 256 ? model : null
  } catch { return null }
}

// The host opts this disposable location into conversational dispatch. The
// model cannot supply a capability, task, tier, target session or permission.
export async function installConversation(ctx: Plugin.Context, project: string, endpoint: string | undefined,
  dispatch: (id: string, instruction: string, signal: AbortSignal, model: ModelRef, steps?: string[]) => Promise<{ status?: string; reason: string; output?: string; workspaceFile?: string; evidence?: { sha256: string; passed: boolean; results: unknown[]; changes?: { path: string; sha256: string }[] }; route?: { model: ModelRef | null }; auditor?: ModelRef; requests?: unknown; review?: unknown; trace?: { path: string; head: string }; observedTokens?: number }>,
  authorize?: (instruction: string) => Promise<void>) {
  const config = async () => validateConfig(await ctx.storage.get("config"))
  const permits = new Map<string, { id: string; text: string; wire?: string | null }>()
  let projectTurn: { sessionID: string; messageID: string; requests: number; deadline: AbortSignal } | undefined
  if (authorize) await ctx.session.hook("title", async e => {
    if ((await config()).enabled && (await ctx.session.get({ sessionID: e.sessionID })).agent === "build") e.result = "GOAT project"
  })
  await ctx.tool.transform(editor => editor.add({
    name: tool, description: "Run GOAT verification for this user message." + (authorize ? " Optional ordered steps in Resink only." : " Takes no arguments."),
    options: { codemode: false, permission: tool },
    input: { type: "object", properties: authorize ? { steps: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", maxLength: 512 } } } : {}, additionalProperties: false },
    async execute(_input, call) {
      const permit = permits.get(call.sessionID)
      permits.delete(call.sessionID)
      if (call.agent !== "build" || !permit) throw Error("No pending GOAT user turn")
      const history = await ctx.session.context({ sessionID: call.sessionID })
      const user = history.filter(m => m.type === "user").at(-1)
      const manager = history.find(m => m.id === call.messageID)
      if (user?.id !== permit.id || user.text !== permit.text || manager?.type !== "assistant" ||
        manager.agent !== call.agent || endpoint && manager.model.providerID !== "fixture" || history.indexOf(manager) <= history.indexOf(user)) {
        throw Error("GOAT user turn changed")
      }
      const steps = (_input as { steps?: string[] }).steps
      if (steps && (!authorize || (await config()).mode !== "resink")) throw Error("Manager planning requires Resink")
      const result = await dispatch(call.sessionID, user.text, call.signal, { providerID: manager.model.providerID, modelID: manager.model.id }, steps)
      if (!endpoint) await ctx.storage.set("lastCodingTurn", { sessionID: call.sessionID, messageID: user.id, status: result.status ?? "failed", reason: result.reason, ...(result.output && { summary: result.output }), ...(result.trace && { trace: result.trace }) })
      // The native tool record, not the Manager's prose, carries the verdict.
      return { content: JSON.stringify({ status: result.status, reason: result.reason,
        ...(result.workspaceFile && { file: result.workspaceFile, sha256: result.evidence?.sha256, checksPassed: result.evidence?.passed,
          worker: result.route?.model, auditor: result.auditor, manager: manager.model,
          managerRequestModel: permit.wire ?? null, requests: result.requests, checks: result.evidence?.results.length,
          ...(result.evidence?.changes && { files: result.evidence.changes.map(({ path, sha256 }) => ({ path, sha256 })),
            suites: result.evidence.results, review: result.review, trace: result.trace, observedRoleTokens: result.observedTokens }) }),
        ...(result.status === "completed" && { output: result.output }) }) }
    },
  }))
  if (authorize) await ctx.tool.hook("execute.before", async e => {
    if (e.agent === "build" && (await config()).enabled && (e.tool !== tool || !permits.has(e.sessionID))) {
      throw Error("Manager lacks a verified user turn")
    }
  })
  await ctx.session.hook("experimental.model.resolve", async e => {
    if (e.agent !== "build" || e.kind !== "primary") return
    const cfg = await config()
    if (!cfg.enabled) return
    if (endpoint && e.model.providerID !== "fixture") throw Error("GOAT conversation requires the local fixture provider")
    if (!cfg.inheritManagerModel) {
      const ref = cfg.models.manager
      if (!ref || ref.providerID !== e.model.providerID) throw Error("Select the Manager provider in the source session first")
      e.model = { providerID: e.model.providerID, id: Model.ID.make(ref.modelID) }
    }
  })
  await ctx.session.hook("context", async e => {
    if (e.agent !== "build" || !(await config()).enabled) {
      delete e.tools[tool]
      return
    }
    const { sessionID } = e
    permits.delete(sessionID)
    for (const name of Object.keys(e.tools)) if (name !== tool) delete e.tools[name]
    const source = await ctx.session.get({ sessionID })
    if (source.location.directory !== project || source.parentID || source.metadata?.goatRole || endpoint && e.model.providerID !== "fixture") {
      delete e.tools[tool]
      return
    }
    const history = await ctx.session.context({ sessionID })
    const user = history.filter(m => m.type === "user").at(-1)
    if (e.messages.at(-1)?.role === "user" && user && !user.files?.length && !user.skills?.length && !user.agents?.length &&
      !history.slice(history.indexOf(user) + 1).some(m => m.type === "synthetic" || (m.type === "assistant" && m.content.length > 0))) {
      if (!e.tools[tool]) throw Error("Local Manager lacks GOAT verification permission")
      if (authorize) {
        await authorize(user.text)
        if (projectTurn && (projectTurn.sessionID !== sessionID || projectTurn.messageID !== user.id)) throw Error("Project grant already bound")
        projectTurn ??= { sessionID, messageID: user.id, requests: 0, deadline: AbortSignal.timeout(360000) }
      }
      permits.set(sessionID, { id: user.id, text: user.text })
      if (!endpoint) await ctx.storage.set("lastCodingTurn", { sessionID, messageID: user.id, status: "unverified", reason: "no GOAT receipt yet" })
      const args = authorize && (await config()).mode === "resink" ? "with an ordered steps array of up to four scoped objectives derived only from the user's intent" : "with {}"
      e.system.push({ type: "text", text: `You are the GOAT Manager. Call ${tool} once, ${args}, for this user turn. Do not answer before verification.` })
    } else {
      delete e.tools[tool]
      e.system.push({ type: "text", text: "Report the latest GOAT tool result. For completed return its exact verified output, including the host's checks and result path. Worker summaries and child notifications are not verification. Otherwise report the failure; never claim completion without a completed receipt for this turn." })
    }
  })
  await ctx.session.hook("http.request", async e => {
    if (e.agent !== "build" || !(await config()).enabled) return
    if (authorize) {
      if (e.kind !== "primary" || projectTurn?.sessionID !== e.sessionID || ++projectTurn.requests > 2) throw Error("Outside authorized Manager requests")
      e.request = new Request(e.request, { signal: AbortSignal.any([e.request.signal, projectTurn.deadline]) })
    }
    if (e.kind !== "primary") return
    if (!endpoint) {
      const p = permits.get(e.sessionID)
      if (p) p.wire = await wireModel(e.request)
      return
    }
    if (e.request.url !== `${endpoint}/chat/completions` || e.model.providerID !== "fixture") throw Error("Invalid local Manager request")
    // Pin the first local OpenAI-compatible request to the single tool. The
    // provider still generates the tool call; GOAT never synthesizes one.
    if (permits.has(e.sessionID)) {
      const body = await e.request.clone().json()
      if (body.tools?.length !== 1 || body.tools[0].function?.name !== tool) throw Error("Unbounded Manager tool inventory")
      body.tool_choice = { type: "function", function: { name: tool } }
      e.request = new Request(e.request, { body: JSON.stringify(body) })
    }
  })
  await ctx.session.hook("experimental.idle", async e => {
    const missed = permits.get(e.sessionID)
    permits.delete(e.sessionID)
    if (missed && !endpoint) await ctx.storage.set("lastCodingTurn", {
      sessionID: e.sessionID, messageID: missed.id, status: "failed", reason: "manager_did_not_invoke_tool",
    })
  })
}
