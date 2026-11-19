import type { GoatConfig, ModelRef } from "../config.js"
import { createIntent } from "./intent.js"
import type { CapabilityTier, ManagerReasoner, OriginalIntent, RoutingDecision, TaskAnalysis, TaskDecisionResult, TaskPlan, TaskSpecification, VerificationRequirements, WorkerPrompt } from "./contracts.js"
import { planResink, planStandard } from "./planner.js"
import { compileWorkerPrompt } from "./prompt.js"
import { analyzeTask, routeTask, validateManagerModel } from "./routing.js"
import { assertTaskInScope, assertTaskPreservesIntent, validateTaskAnalysis, validateTaskDecisionResult, validateTaskPlan, validateTaskSpecification } from "./validate.js"

function assertDecisionConfig(config: GoatConfig): void {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid GOAT configuration")
  const allowed = ["version", "enabled", "mode", "inheritManagerModel", "models"]
  if (Object.keys(config).some((key) => !allowed.includes(key))) throw new Error("Invalid GOAT configuration")
  if (config.version !== 1 || typeof config.enabled !== "boolean" || (config.mode !== "standard" && config.mode !== "resink") || typeof config.inheritManagerModel !== "boolean" || !config.models || typeof config.models !== "object" || Array.isArray(config.models)) {
    throw new Error("Invalid GOAT configuration")
  }
  const roles = ["manager", "l1", "l2", "l3", "auditor"] as const
  for (const key of Object.keys(config.models)) {
    if (!roles.includes(key as typeof roles[number])) throw new Error(`Unknown GOAT model role: ${key}`)
  }
  for (const role of roles) {
    const ref = config.models[role]
    if (ref === undefined) continue
    if (!ref || typeof ref !== "object" || Array.isArray(ref) || typeof ref.providerID !== "string" || !ref.providerID || typeof ref.modelID !== "string" || !ref.modelID) {
      throw new Error(`Invalid ${role} model reference`)
    }
  }
}

function assertAvailableModels(models: readonly ModelRef[] | undefined): void {
  if (models === undefined) return
  if (!Array.isArray(models)) throw new Error("Invalid availableModels: expected array")
  for (const model of models) {
    if (!model || typeof model !== "object" || Array.isArray(model) || typeof model.providerID !== "string" || !model.providerID || typeof model.modelID !== "string" || !model.modelID) {
      throw new Error("Invalid availableModels entry: providerID and modelID are required")
    }
  }
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)]
}

function normalizeTask(intent: OriginalIntent, task: TaskSpecification, extraCriteria: readonly string[]): TaskSpecification {
  return validateTaskSpecification({
    ...task,
    executionConstraints: unique([...task.executionConstraints, ...intent.constraints]),
    prohibitions: unique([...task.prohibitions, ...intent.prohibitions]),
    toolRestrictions: unique([...task.toolRestrictions, ...intent.permissionBoundaries]),
    acceptanceCriteria: unique([...task.acceptanceCriteria, ...intent.acceptanceCriteria, ...extraCriteria]),
    sourceRequirements: unique([...task.sourceRequirements, `intent:${intent.id}`]),
  })
}

export type TaskDecisionRequest = {
  readonly instruction: string
  readonly outcome?: string
  readonly constraints?: readonly string[]
  readonly prohibitions?: readonly string[]
  readonly userPlan?: readonly string[] | null
  readonly acceptanceCriteria?: readonly string[]
  readonly ambiguities?: readonly string[]
  readonly permissionBoundaries?: readonly string[]
  readonly config: GoatConfig
  readonly availableModels?: readonly ModelRef[]
  readonly reasoner?: ManagerReasoner
  readonly intentId?: string
  readonly tier?: CapabilityTier
}

function verificationFor(task: TaskSpecification, intent: OriginalIntent): VerificationRequirements {
  return {
    taskId: task.id,
    criteria: task.acceptanceCriteria.length > 0 ? task.acceptanceCriteria : [intent.outcome],
    evidenceExpected: [
      "Worker report mapped to each acceptance criterion",
      "Test, check, or inspection evidence where applicable",
      "Explicit disclosure of any scope deviation or unresolved risk",
    ],
    passCondition: "all-criteria",
  }
}

const decisionRequestKeys = [
  "config",
  "instruction",
  "outcome",
  "constraints",
  "prohibitions",
  "userPlan",
  "acceptanceCriteria",
  "ambiguities",
  "permissionBoundaries",
  "availableModels",
  "reasoner",
  "intentId",
  "tier",
]

export async function decideTask(request: TaskDecisionRequest): Promise<TaskDecisionResult> {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Invalid decision request: expected object")
  const unknown = Object.keys(request).find((key) => !decisionRequestKeys.includes(key))
  if (unknown) throw new Error(`Invalid decision request: unknown field ${unknown}`)
  if (request.tier !== undefined && !["L1", "L2", "L3"].includes(request.tier)) {
    throw new Error(`Invalid decision request: capability tier ${String(request.tier)}`)
  }
  assertDecisionConfig(request.config)
  assertAvailableModels(request.availableModels)
  const intent = createIntent({
    id: request.intentId,
    instruction: request.instruction,
    outcome: request.outcome,
    constraints: request.constraints,
    prohibitions: request.prohibitions,
    userPlan: request.userPlan,
    acceptanceCriteria: request.acceptanceCriteria,
    ambiguities: request.ambiguities,
    permissionBoundaries: request.permissionBoundaries,
  })

  if (!request.config.enabled) {
    return validateTaskDecisionResult({
      status: "bypassed",
      reason: "GOAT is OFF; no decision pipeline, worker prompt, or model request was executed.",
      intent,
      tasks: [],
      plan: null,
      decisions: [],
      prompts: [],
      verification: [],
    })
  }

  validateManagerModel(request.config, request.availableModels)

  let tasks: readonly TaskSpecification[]
  let plan: TaskPlan | null = null
  if (request.config.mode === "standard") {
    tasks = planStandard(intent, request.userPlan ?? intent.userPlan).tasks
  } else {
    plan = planResink(intent, request.userPlan ?? intent.userPlan)
    tasks = plan.tasks
  }

  if (request.tier !== undefined) {
    tasks = tasks.map((task) => validateTaskSpecification({ ...task, tier: request.tier }))
  }
  const extraCriteria = plan?.acceptanceCriteria ?? []
  tasks = tasks.map((task) => normalizeTask(intent, task, extraCriteria))
  if (plan) {
    plan = validateTaskPlan({
      ...plan,
      tasks,
      acceptanceCriteria: unique([...plan.acceptanceCriteria, ...intent.acceptanceCriteria]),
    })
  }
  for (const task of tasks) {
    assertTaskInScope(task)
    assertTaskPreservesIntent(intent, task)
  }

  const decisions: RoutingDecision[] = []
  const prompts: WorkerPrompt[] = []
  const verification: VerificationRequirements[] = []
  for (const task of tasks) {
    let analysis: TaskAnalysis
    if (request.reasoner?.analyzeTask) {
      const supplied = validateTaskAnalysis(await request.reasoner.analyzeTask(task, intent))
      analysis = {
        ...supplied,
        reasons: supplied.reasons.length > 0 ? supplied.reasons : ["Manager reasoner supplied no rationale."],
        uncertainty: unique([
          ...supplied.uncertainty,
          "Model capability metadata is unavailable; routing uses the configured tier policy.",
          "Manager reasoner supplied the classification; its rationale must be reviewed.",
        ]),
      }
    } else {
      analysis = analyzeTask({
        objective: task.objective,
        constraints: task.executionConstraints,
        acceptanceCriteria: task.acceptanceCriteria,
        prohibitions: task.prohibitions,
      })
    }
    const routed = routeTask(task, request.config, request.availableModels, analysis)
    const decision: RoutingDecision = {
      ...routed.decision,
      decisionSource: request.reasoner?.analyzeTask ? "manager_reasoner" : "deterministic",
    }
    decisions.push(decision)
    const upstream = (plan?.dependencies ?? [])
      .filter((dependency) => dependency.to === task.id)
      .map((dependency) => `${dependency.from}: ${dependency.reason}`)
    prompts.push(compileWorkerPrompt(task, decision.tier, intent, upstream))
    verification.push(verificationFor(task, intent))
  }

  return validateTaskDecisionResult({
    status: "planned",
    intent,
    tasks,
    plan,
    decisions,
    prompts,
    verification,
  })
}
