import type {
  CapabilityTier,
  DispatchReadiness,
  OriginalIntent,
  RoutingDecision,
  ScopeFinding,
  TaskAnalysis,
  TaskComplexity,
  TaskContextNeed,
  TaskDecisionResult,
  TaskPlan,
  TaskRisk,
  TaskSpecification,
  VerificationRequirements,
  WorkerPrompt,
} from "./contracts.js"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value)
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  }
  return value
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${field}: expected non-empty string`)
  return value.trim()
}

function readStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`Invalid ${field}: expected string array`)
  const items = value.map((item) => item.trim())
  if (items.some((item) => !item)) throw new Error(`Invalid ${field}: blank entries are not allowed`)
  return items
}

function readOptionalStringArray(value: unknown, field: string): string[] | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`Invalid ${field}: expected string array or null`)
  const items = value.map((item) => item.trim())
  if (items.some((item) => !item)) throw new Error(`Invalid ${field}: blank task entries are not allowed`)
  return items
}

const complexities: readonly TaskComplexity[] = ["simple", "moderate", "complex"]
const risks: readonly TaskRisk[] = ["low", "medium", "high"]
const contexts: readonly TaskContextNeed[] = ["minimal", "standard", "extensive"]
const tiers: readonly CapabilityTier[] = ["L1", "L2", "L3"]

export function validateOriginalIntent(value: unknown): OriginalIntent {
  if (!isPlainObject(value)) throw new Error("Invalid OriginalIntent: expected object")
  const id = readString(value.id, "OriginalIntent.id")
  if (typeof value.instruction !== "string" || !value.instruction.trim()) throw new Error("Invalid OriginalIntent.instruction: expected non-empty string")
  const instruction = value.instruction
  const outcome = typeof value.outcome === "string" && value.outcome.trim() ? value.outcome.trim() : instruction
  const constraints = readStringArray(value.constraints, "OriginalIntent.constraints")
  const prohibitions = readStringArray(value.prohibitions, "OriginalIntent.prohibitions")
  const userPlan = readOptionalStringArray(value.userPlan, "OriginalIntent.userPlan")
  const acceptanceCriteria = readStringArray(value.acceptanceCriteria, "OriginalIntent.acceptanceCriteria")
  const ambiguities = readStringArray(value.ambiguities, "OriginalIntent.ambiguities")
  const permissionBoundaries = readStringArray(value.permissionBoundaries, "OriginalIntent.permissionBoundaries")
  return deepFreeze({
    id,
    instruction,
    outcome,
    constraints,
    prohibitions,
    userPlan,
    acceptanceCriteria,
    ambiguities,
    permissionBoundaries,
  })
}

export function validateTaskSpecification(value: unknown): TaskSpecification {
  if (!isPlainObject(value)) throw new Error("Invalid TaskSpecification: expected object")
  const id = readString(value.id, "TaskSpecification.id")
  const intentId = readString(value.intentId, "TaskSpecification.intentId")
  const objective = readString(value.objective, "TaskSpecification.objective")
  const complexity = complexities.includes(value.complexity as TaskComplexity) ? (value.complexity as TaskComplexity) : (() => { throw new Error("Invalid TaskSpecification.complexity") })()
  const risk = risks.includes(value.risk as TaskRisk) ? (value.risk as TaskRisk) : (() => { throw new Error("Invalid TaskSpecification.risk") })()
  const contextNeed = contexts.includes(value.contextNeed as TaskContextNeed) ? (value.contextNeed as TaskContextNeed) : (() => { throw new Error("Invalid TaskSpecification.contextNeed") })()
  const tier = value.tier === undefined ? undefined : tiers.includes(value.tier as CapabilityTier) ? (value.tier as CapabilityTier) : (() => { throw new Error("Invalid TaskSpecification.tier") })()
  const executionConstraints = readStringArray(value.executionConstraints, "TaskSpecification.executionConstraints")
  const deliverables = readStringArray(value.deliverables, "TaskSpecification.deliverables")
  const acceptanceCriteria = readStringArray(value.acceptanceCriteria, "TaskSpecification.acceptanceCriteria")
  const prohibitions = readStringArray(value.prohibitions, "TaskSpecification.prohibitions")
  const toolRestrictions = readStringArray(value.toolRestrictions, "TaskSpecification.toolRestrictions")
  const reportingFormat = readString(value.reportingFormat, "TaskSpecification.reportingFormat")
  const sourceRequirements = readStringArray(value.sourceRequirements, "TaskSpecification.sourceRequirements")
  if (sourceRequirements.length === 0) throw new Error("Invalid TaskSpecification.sourceRequirements: expected non-empty array")
  return {
    id,
    intentId,
    objective,
    complexity,
    risk,
    contextNeed,
    ...(tier ? { tier } : {}),
    executionConstraints,
    deliverables,
    acceptanceCriteria,
    prohibitions,
    toolRestrictions,
    reportingFormat,
    sourceRequirements,
  }
}

export function validateTaskAnalysis(value: unknown): TaskAnalysis {
  if (!isPlainObject(value)) throw new Error("Invalid TaskAnalysis: expected object")
  const complexity = complexities.includes(value.complexity as TaskComplexity) ? (value.complexity as TaskComplexity) : (() => { throw new Error("Invalid TaskAnalysis.complexity") })()
  const risk = risks.includes(value.risk as TaskRisk) ? (value.risk as TaskRisk) : (() => { throw new Error("Invalid TaskAnalysis.risk") })()
  const contextNeed = contexts.includes(value.contextNeed as TaskContextNeed) ? (value.contextNeed as TaskContextNeed) : (() => { throw new Error("Invalid TaskAnalysis.contextNeed") })()
  const tier = value.tier === undefined ? undefined : tiers.includes(value.tier as CapabilityTier) ? (value.tier as CapabilityTier) : (() => { throw new Error("Invalid TaskAnalysis.tier") })()
  const reasons = readStringArray(value.reasons, "TaskAnalysis.reasons")
  const uncertainty = readStringArray(value.uncertainty, "TaskAnalysis.uncertainty")
  return { complexity, risk, contextNeed, ...(tier ? { tier } : {}), reasons, uncertainty }
}

export function validateTaskPlan(value: unknown): TaskPlan {
  if (!isPlainObject(value)) throw new Error("Invalid TaskPlan: expected object")
  if (value.mode !== "resink") throw new Error("Invalid TaskPlan.mode: expected resink")
  const intentId = readString(value.intentId, "TaskPlan.intentId")
  if (!Array.isArray(value.tasks)) throw new Error("Invalid TaskPlan.tasks: expected array")
  const tasks = value.tasks.map(validateTaskSpecification)
  if (tasks.length === 0) throw new Error("Invalid TaskPlan.tasks: expected non-empty array")
  if (tasks.some((task) => task.intentId !== intentId)) throw new Error("Invalid TaskPlan.tasks: every task must belong to the plan intent")
  const ids = new Set(tasks.map((task) => task.id))
  if (ids.size !== tasks.length) throw new Error("Invalid TaskPlan.tasks: duplicate task ids")
  if (!Array.isArray(value.dependencies)) throw new Error("Invalid TaskPlan.dependencies: expected array")
  const dependencies = value.dependencies.map((item) => {
    if (!isPlainObject(item)) throw new Error("Invalid TaskPlan.dependencies: expected object")
    const from = readString(item.from, "TaskPlan.dependencies.from")
    const to = readString(item.to, "TaskPlan.dependencies.to")
    if (!ids.has(from) || !ids.has(to)) throw new Error("Invalid TaskPlan.dependencies: unknown task id")
    return {
      from,
      to,
      reason: typeof item.reason === "string" && item.reason.trim() ? item.reason.trim() : "sequential execution",
    }
  })
  const graph = new Map<string, string[]>()
  for (const dependency of dependencies) graph.set(dependency.from, [...(graph.get(dependency.from) ?? []), dependency.to])
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("Invalid TaskPlan.dependencies: cycle detected")
    if (visited.has(id)) return
    visiting.add(id)
    for (const next of graph.get(id) ?? []) visit(next)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of ids) visit(id)
  const acceptanceCriteria = readStringArray(value.acceptanceCriteria, "TaskPlan.acceptanceCriteria")
  return { mode: "resink", intentId, tasks, dependencies, acceptanceCriteria }
}

export function validateRoutingDecision(value: unknown): RoutingDecision {
  if (!isPlainObject(value)) throw new Error("Invalid RoutingDecision: expected object")
  const taskId = readString(value.taskId, "RoutingDecision.taskId")
  const tier = tiers.includes(value.tier as CapabilityTier) ? (value.tier as CapabilityTier) : (() => { throw new Error("Invalid RoutingDecision.tier") })()
  const reasons = readStringArray(value.reasons, "RoutingDecision.reasons")
  const uncertainty = readStringArray(value.uncertainty, "RoutingDecision.uncertainty")
  const decisionSource = value.decisionSource === "deterministic" || value.decisionSource === "manager_reasoner" ? value.decisionSource : (() => { throw new Error("Invalid RoutingDecision.decisionSource") })()
  const model = value.model === null ? null : (isPlainObject(value.model) ? { providerID: readString(value.model.providerID, "RoutingDecision.model.providerID"), modelID: readString(value.model.modelID, "RoutingDecision.model.modelID") } : (() => { throw new Error("Invalid RoutingDecision.model") })())
  return { taskId, tier, reasons, uncertainty, decisionSource, model }
}

export function validateWorkerPrompt(value: unknown): WorkerPrompt {
  if (!isPlainObject(value)) throw new Error("Invalid WorkerPrompt: expected object")
  const taskId = readString(value.taskId, "WorkerPrompt.taskId")
  const tier = tiers.includes(value.tier as CapabilityTier) ? (value.tier as CapabilityTier) : (() => { throw new Error("Invalid WorkerPrompt.tier") })()
  if (!isPlainObject(value.sections)) throw new Error("Invalid WorkerPrompt.sections: expected object")
  const sections = {
    objective: readString(value.sections.objective, "WorkerPrompt.sections.objective"),
    context: readString(value.sections.context, "WorkerPrompt.sections.context"),
    scope: readString(value.sections.scope, "WorkerPrompt.sections.scope"),
    deliverables: readString(value.sections.deliverables, "WorkerPrompt.sections.deliverables"),
    acceptance: readString(value.sections.acceptance, "WorkerPrompt.sections.acceptance"),
    prohibitions: readString(value.sections.prohibitions, "WorkerPrompt.sections.prohibitions"),
    restrictions: readString(value.sections.restrictions, "WorkerPrompt.sections.restrictions"),
    reporting: readString(value.sections.reporting, "WorkerPrompt.sections.reporting"),
  }
  const tierGuidance = readString(value.tierGuidance, "WorkerPrompt.tierGuidance")
  const text = readString(value.text, "WorkerPrompt.text")
  return { taskId, tier, sections, tierGuidance, text }
}

export function validateVerificationRequirements(value: unknown): VerificationRequirements {
  if (!isPlainObject(value)) throw new Error("Invalid VerificationRequirements: expected object")
  const taskId = readString(value.taskId, "VerificationRequirements.taskId")
  const criteria = readStringArray(value.criteria, "VerificationRequirements.criteria")
  const evidenceExpected = readStringArray(value.evidenceExpected, "VerificationRequirements.evidenceExpected")
  if (value.passCondition !== "all-criteria") throw new Error("Invalid VerificationRequirements.passCondition")
  return { taskId, criteria, evidenceExpected, passCondition: "all-criteria" }
}

const prohibitionPrefix = /^(?:do not|don['’]t|never|must not|shall not|should not|avoid|without|no|cannot|can['’]t|under no circumstances|prohibited|forbidden|not(?!\s+only)|refrain from)\b/i

export function isProhibitionText(value: string): boolean {
  return prohibitionPrefix.test(value.trim())
}

const scopeFindingCodes = [
  "possible-out-of-scope-action",
  "ambiguous-instruction",
  "high-risk-instruction",
  "high-risk-task",
  "skipped-non-actionable-item",
  "no-actionable-task",
] as const

const scopeFindingSeverities = ["advisory", "review"] as const

export function validateScopeFinding(value: unknown): ScopeFinding {
  if (!isPlainObject(value)) throw new Error("Invalid ScopeFinding: expected object")
  const code = scopeFindingCodes.includes(value.code as typeof scopeFindingCodes[number])
    ? (value.code as ScopeFinding["code"])
    : (() => { throw new Error("Invalid ScopeFinding.code") })()
  const severity = scopeFindingSeverities.includes(value.severity as typeof scopeFindingSeverities[number])
    ? (value.severity as ScopeFinding["severity"])
    : (() => { throw new Error("Invalid ScopeFinding.severity") })()
  const message = readString(value.message, "ScopeFinding.message")
  const evidence = readString(value.evidence, "ScopeFinding.evidence")
  const taskId = value.taskId === undefined ? undefined : readString(value.taskId, "ScopeFinding.taskId")
  return { code, severity, message, evidence, ...(taskId ? { taskId } : {}) }
}

export function validateDispatchReadiness(value: unknown): DispatchReadiness {
  if (value !== "ready" && value !== "needs_review" && value !== "not_applicable") {
    throw new Error("Invalid TaskDecisionResult.readiness")
  }
  return value
}

export function assertTaskPreservesIntent(intent: OriginalIntent, task: TaskSpecification): void {
  if (task.intentId !== intent.id) throw new Error(`Task ${task.id} is not traceable to the original intent`)
  for (const prohibition of intent.prohibitions) {
    if (!task.prohibitions.includes(prohibition)) throw new Error(`Task ${task.id} dropped an explicit prohibition: ${prohibition}`)
  }
  for (const constraint of intent.constraints) {
    if (!task.executionConstraints.includes(constraint)) throw new Error(`Task ${task.id} dropped an explicit constraint: ${constraint}`)
  }
  for (const criterion of intent.acceptanceCriteria) {
    if (!task.acceptanceCriteria.includes(criterion)) throw new Error(`Task ${task.id} dropped an acceptance criterion: ${criterion}`)
  }
  for (const boundary of intent.permissionBoundaries) {
    if (!task.toolRestrictions.includes(boundary)) throw new Error(`Task ${task.id} dropped a permission boundary: ${boundary}`)
  }
  if (!task.sourceRequirements.some((requirement) => requirement === `intent:${intent.id}`)) {
    throw new Error(`Task ${task.id} is missing an intent source requirement`)
  }
}

export function validateTaskDecisionResult(value: unknown): TaskDecisionResult {
  if (!isPlainObject(value)) throw new Error("Invalid TaskDecisionResult: expected object")
  const status = value.status === "planned" || value.status === "needs_review" || value.status === "bypassed" ? value.status : (() => { throw new Error("Invalid TaskDecisionResult.status") })()
  const reason = value.reason === undefined ? undefined : readString(value.reason, "TaskDecisionResult.reason")
  if (!isPlainObject(value.intent)) throw new Error("Invalid TaskDecisionResult.intent")
  const intent = deepFreeze(validateOriginalIntent(value.intent))
  if (!Array.isArray(value.tasks)) throw new Error("Invalid TaskDecisionResult.tasks")
  const tasks = value.tasks.map(validateTaskSpecification)
  const plan = value.plan === null ? null : validateTaskPlan(value.plan)
  if (!Array.isArray(value.decisions)) throw new Error("Invalid TaskDecisionResult.decisions")
  const decisions = value.decisions.map(validateRoutingDecision)
  if (!Array.isArray(value.prompts)) throw new Error("Invalid TaskDecisionResult.prompts")
  const prompts = value.prompts.map(validateWorkerPrompt)
  if (!Array.isArray(value.verification)) throw new Error("Invalid TaskDecisionResult.verification")
  const verification = value.verification.map(validateVerificationRequirements)
  if (!Array.isArray(value.scopeFindings)) throw new Error("Invalid TaskDecisionResult.scopeFindings")
  const scopeFindings = value.scopeFindings.map(validateScopeFinding)
  const reviewReasons = readStringArray(value.reviewReasons, "TaskDecisionResult.reviewReasons")
  const readiness = validateDispatchReadiness(value.readiness)
  if (decisions.length !== tasks.length || prompts.length !== tasks.length || verification.length !== tasks.length) {
    throw new Error("Invalid TaskDecisionResult: decisions, prompts, and verification must align with tasks")
  }
  const taskIds = new Set(tasks.map((task) => task.id))
  for (const finding of scopeFindings) {
    if (finding.taskId && !taskIds.has(finding.taskId)) throw new Error("Invalid TaskDecisionResult: scope finding references an unknown task")
  }
  tasks.forEach((task, index) => {
    if (decisions[index].taskId !== task.id || prompts[index].taskId !== task.id || verification[index].taskId !== task.id) {
      throw new Error("Invalid TaskDecisionResult: artifact taskId does not match task order")
    }
    if (task.tier && decisions[index].tier !== task.tier) throw new Error("Invalid TaskDecisionResult: decision tier does not match the explicit task tier")
    if (prompts[index].tier !== decisions[index].tier) throw new Error("Invalid TaskDecisionResult: prompt tier does not match the decision tier")
  })
  if (plan && (plan.tasks.length !== tasks.length || plan.tasks.some((task, index) => task.id !== tasks[index].id))) {
    throw new Error("Invalid TaskDecisionResult: plan tasks must match result tasks")
  }
  tasks.forEach((task) => assertTaskPreservesIntent(intent, task))
  if (plan) {
    for (const criterion of plan.acceptanceCriteria) {
      if (tasks.some((task) => !task.acceptanceCriteria.includes(criterion))) {
        throw new Error("Invalid TaskDecisionResult: plan acceptance criteria were not propagated to every task")
      }
    }
  }
  if (status === "bypassed" && (tasks.length > 0 || decisions.length > 0 || prompts.length > 0 || verification.length > 0 || plan !== null)) {
    throw new Error("Invalid TaskDecisionResult: bypassed result must not contain tasks or prompts")
  }
  if (status === "bypassed" && (readiness !== "not_applicable" || scopeFindings.length > 0 || reviewReasons.length > 0)) {
    throw new Error("Invalid TaskDecisionResult: bypassed result must not contain findings or dispatch readiness")
  }
  if (status === "planned" && tasks.length === 0) throw new Error("Invalid TaskDecisionResult: planned result must contain at least one task")
  if (status !== "bypassed" && readiness === "not_applicable") {
    throw new Error("Invalid TaskDecisionResult: non-bypassed result must declare dispatch readiness")
  }
  if (status === "needs_review" && readiness !== "needs_review") {
    throw new Error("Invalid TaskDecisionResult: needs_review status requires needs_review readiness")
  }
  if (status === "needs_review" && reviewReasons.length === 0) {
    throw new Error("Invalid TaskDecisionResult: needs_review status requires review reasons")
  }
  const reviewFindings = scopeFindings.filter((finding) => finding.severity === "review")
  if (readiness === "ready") {
    if (reviewFindings.length > 0 || reviewReasons.length > 0) throw new Error("Invalid TaskDecisionResult: ready result must not contain review findings or review reasons")
    if (intent.ambiguities.length > 0) throw new Error("Invalid TaskDecisionResult: ambiguous instructions must be marked needs_review")
    if (tasks.some((task) => task.risk === "high")) throw new Error("Invalid TaskDecisionResult: high-risk tasks must be marked needs_review")
  }
  if (readiness === "needs_review") {
    if (reviewReasons.length === 0) throw new Error("Invalid TaskDecisionResult: needs_review requires at least one review reason")
    for (const finding of reviewFindings) {
      if (!reviewReasons.includes(finding.message)) throw new Error("Invalid TaskDecisionResult: every review finding must be listed in reviewReasons")
    }
  }
  return { status, reason, intent, tasks, plan, decisions, prompts, verification, scopeFindings, reviewReasons, readiness }
}
