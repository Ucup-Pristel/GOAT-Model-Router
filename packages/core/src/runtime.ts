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

// Per dispatch. Reserve synchronously at the actual metered boundary, including
// follow-up model requests within a single Worker or Auditor turn.
export class RoleBudget {
  private used = 0
  private readonly tokens = new Map<string, number>()

  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw Error("Invalid role request budget")
  }

  get requests() { return this.used }
  get remaining() { return this.limit - this.used }
  get observedTokens() { return [...this.tokens.values()].reduce((a, b) => a + b, 0) }

  reserve() {
    if (!this.remaining) throw Error("Role request budget exhausted")
    return ++this.used
  }

  observe(id: string, cumulative: number) {
    if (!Number.isSafeInteger(cumulative) || cumulative < 0) throw Error("Invalid observed role token count")
    this.tokens.set(id, Math.max(this.tokens.get(id) ?? 0, cumulative))
    if (this.observedTokens > 128000) throw Error("Observed role token budget exceeded")
  }
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
  const keys = ["maxModelRequests", "maxDurationMs", "maxWorkerRetries", "maxAuditorRetries", "maxExecutionDepth"] as const
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid runtime budget")
  for (const key of Object.keys(value)) {
    if (!keys.includes(key as (typeof keys)[number])) throw new Error(`Invalid runtime budget: ${key}`)
  }
  for (const key of keys) {
    const number = (value as unknown as Record<string, unknown>)[key]
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) throw new Error(`Invalid runtime budget: ${key}`)
  }
  if (value.maxDurationMs === 0 || value.maxExecutionDepth === 0) throw new Error("Invalid runtime budget: duration and execution depth must be positive")
  return {
    maxModelRequests: value.maxModelRequests,
    maxDurationMs: value.maxDurationMs,
    maxWorkerRetries: value.maxWorkerRetries,
    maxAuditorRetries: value.maxAuditorRetries,
    maxExecutionDepth: value.maxExecutionDepth,
  }
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
  const executionDepth = input.executionDepth ?? 1
  if (!Number.isSafeInteger(executionDepth) || executionDepth <= 0 || executionDepth > budget.maxExecutionDepth) throw new Error("Invalid runtime execution depth")
  const run: RuntimeRun = {
    id: input.id,
    intent: input.intent,
    task: input.task,
    state: "queued",
    budget,
    modelRequests: 0,
    executionDepth,
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
  const budget = validateRuntimeBudget(run.budget)
  if (!Number.isSafeInteger(run.executionDepth) || run.executionDepth <= 0) throw new Error("Invalid runtime execution depth")
  if (run.executionDepth > budget.maxExecutionDepth) throw new Error("Runtime execution depth exceeds budget")
  if (run.modelRequests >= budget.maxModelRequests) throw new Error("Runtime model-request budget exhausted")
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
