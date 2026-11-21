import type { OriginalIntent, TaskDecisionResult, TaskSpecification } from "./manager/contracts.js"

export type RuntimeOperation =
  | "filesystem_read"
  | "filesystem_write"
  | "process"
  | "network"
  | "credential"
  | "git_push"
  | "publish"
  | "deploy"
  | "destructive"
  | "unknown"

export type RuntimeState = "queued" | "authorized" | "running" | "auditing" | "completed" | "failed" | "blocked" | "cancelled"

export type RuntimeBudget = {
  readonly maxModelRequests: number
  readonly maxDurationMs: number
  readonly maxWorkerRetries: number
  readonly maxAuditorRetries: number
  readonly maxExecutionDepth: number
}

export type RuntimeAuthorizationPolicy = {
  readonly hostAllowed: readonly RuntimeOperation[]
  readonly taskAllowed: readonly RuntimeOperation[]
}

export type RuntimeAuthorization = {
  readonly allowed: boolean
  readonly reason: string
}

export type RuntimeTrace = {
  readonly at: string
  readonly event: "authorization" | "dispatch" | "operation" | "budget" | "cancel" | "error"
  readonly state: RuntimeState
  readonly message: string
  readonly operation?: RuntimeOperation
  readonly resource?: string
}

export type RuntimeRun = {
  readonly id: string
  readonly intent: OriginalIntent
  readonly task: TaskSpecification
  readonly state: RuntimeState
  readonly budget: RuntimeBudget
  readonly modelRequests: number
  readonly executionDepth: number
  readonly authorizedOperation?: RuntimeOperation
  readonly authorizedResource?: string
  readonly startedAt?: number
  readonly trace: readonly RuntimeTrace[]
}

const operations: readonly RuntimeOperation[] = [
  "filesystem_read", "filesystem_write", "process", "network", "credential", "git_push", "publish", "deploy", "destructive", "unknown",
]

const highImpact = new Set<RuntimeOperation>(["credential", "git_push", "publish", "deploy", "destructive"])

export const dryRunBudget: RuntimeBudget = {
  maxModelRequests: 0,
  maxDurationMs: 60_000,
  maxWorkerRetries: 0,
  maxAuditorRetries: 0,
  maxExecutionDepth: 1,
}

export const denyAllRuntimePolicy: RuntimeAuthorizationPolicy = {
  hostAllowed: [],
  taskAllowed: [],
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

function trace(run: RuntimeRun, event: RuntimeTrace["event"], message: string, operation?: RuntimeOperation, resource?: string): RuntimeRun {
  return {
    ...run,
    trace: [...run.trace, { at: new Date().toISOString(), event, state: run.state, message, ...(operation ? { operation } : {}), ...(resource ? { resource } : {}) }],
  }
}

export function validateRuntimeBudget(value: RuntimeBudget): RuntimeBudget {
  for (const [key, number] of Object.entries(value)) {
    if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Invalid runtime budget: ${key}`)
  }
  if (value.maxDurationMs === 0 || value.maxExecutionDepth === 0) throw new Error("Invalid runtime budget: duration and execution depth must be positive")
  return { ...value }
}

export function validateRuntimePolicy(value: RuntimeAuthorizationPolicy): RuntimeAuthorizationPolicy {
  for (const [key, allowed] of Object.entries(value)) {
    if (!Array.isArray(allowed) || allowed.some((operation) => !operations.includes(operation as RuntimeOperation))) {
      throw new Error(`Invalid runtime authorization policy: ${key}`)
    }
  }
  return {
    hostAllowed: unique(value.hostAllowed),
    taskAllowed: unique(value.taskAllowed),
  }
}

export function authorizeRuntimeOperation(policy: RuntimeAuthorizationPolicy, operation: RuntimeOperation): RuntimeAuthorization {
  const checked = validateRuntimePolicy(policy)
  if (operation === "unknown") return { allowed: false, reason: "Unknown runtime operation is denied fail-closed." }
  if (highImpact.has(operation)) return { allowed: false, reason: `High-impact operation ${operation} is disabled: no verified Project Owner authority exists.` }
  for (const [source, allowed] of [["host", checked.hostAllowed], ["task", checked.taskAllowed]] as const) {
    if (!allowed.includes(operation)) return { allowed: false, reason: `${source} policy does not authorize ${operation}.` }
  }
  return { allowed: true, reason: `${operation} is authorized by intersected policy.` }
}

export function runtimeEligibility(decision: TaskDecisionResult, task: TaskSpecification, policy: RuntimeAuthorizationPolicy, budget: RuntimeBudget, executionDepth = 1): RuntimeAuthorization {
  validateRuntimeBudget(budget)
  validateRuntimePolicy(policy)
  // Task 2 readiness is advisory only. It cannot authorize runtime execution.
  if (task.intentId !== decision.intent.id) return { allowed: false, reason: "Task is not traceable to immutable OriginalIntent." }
  if (executionDepth > budget.maxExecutionDepth) return { allowed: false, reason: "Execution-depth budget is exhausted." }
  if (budget.maxModelRequests === 0) return { allowed: false, reason: "Model-request budget is zero; dry-run only." }
  return { allowed: true, reason: "Runtime dispatch eligibility passed; each actual operation still requires authorization." }
}

export function createRuntimeRun(input: { id: string; intent: OriginalIntent; task: TaskSpecification; budget: RuntimeBudget; executionDepth?: number }): RuntimeRun {
  const budget = validateRuntimeBudget(input.budget)
  if (!input.id.trim()) throw new Error("Invalid runtime run id")
  if (input.task.intentId !== input.intent.id) throw new Error("Runtime task is not traceable to OriginalIntent")
  const run: RuntimeRun = {
    id: input.id,
    intent: input.intent,
    task: input.task,
    state: "queued",
    budget,
    modelRequests: 0,
    executionDepth: input.executionDepth ?? 1,
    trace: [],
  }
  return trace(run, "dispatch", "Runtime run created in dry state.")
}

export function recordRuntimeAuthorization(run: RuntimeRun, policy: RuntimeAuthorizationPolicy, operation: RuntimeOperation, resource: string): RuntimeRun {
  if (!resource.trim()) throw new Error("Runtime operation resource is required")
  const authorization = authorizeRuntimeOperation(policy, operation)
  const next = trace(run, "authorization", authorization.reason, operation, resource)
  if (!authorization.allowed) return { ...next, state: "blocked" }
  return { ...next, state: run.state === "queued" ? "authorized" : run.state, authorizedOperation: operation, authorizedResource: resource }
}

export function beginRuntimeRun(run: RuntimeRun, operation: RuntimeOperation, resource: string, now = Date.now()): RuntimeRun {
  if (run.state !== "authorized") throw new Error("Runtime run must be authorized before execution")
  if (run.authorizedOperation !== operation || run.authorizedResource !== resource) throw new Error("Runtime operation is not authorized for this resource")
  if (highImpact.has(operation)) throw new Error("High-impact runtime operations are disabled without verified Project Owner authority")
  if (run.modelRequests >= run.budget.maxModelRequests) throw new Error("Runtime model-request budget exhausted")
  return trace({ ...run, state: "running", startedAt: now, modelRequests: run.modelRequests + 1 }, "dispatch", "Runtime execution began.")
}

export function assertRuntimeBudget(run: RuntimeRun, now = Date.now()): RuntimeRun {
  if (run.state !== "running") return run
  if (run.startedAt === undefined || now - run.startedAt <= run.budget.maxDurationMs) return run
  return trace({ ...run, state: "blocked" }, "budget", "Runtime duration budget exhausted.")
}

export function cancelRuntimeRun(run: RuntimeRun, reason: string): RuntimeRun {
  if (["completed", "failed", "blocked", "cancelled"].includes(run.state)) return run
  return trace({ ...run, state: "cancelled" }, "cancel", reason)
}
