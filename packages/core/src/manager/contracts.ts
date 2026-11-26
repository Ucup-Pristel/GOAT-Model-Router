import type { ModelRef } from "../config.js"

export type { ModelRef } from "../config.js"

export type CapabilityTier = "L1" | "L2" | "L3"

export type TaskComplexity = "simple" | "moderate" | "complex"

export type TaskRisk = "low" | "medium" | "high"

export type TaskContextNeed = "minimal" | "standard" | "extensive"

export type GoatMode = "standard" | "resink"

export type OriginalIntent = {
  readonly id: string
  readonly instruction: string
  readonly outcome: string
  readonly constraints: readonly string[]
  readonly prohibitions: readonly string[]
  readonly userPlan: readonly string[] | null
  readonly acceptanceCriteria: readonly string[]
  readonly ambiguities: readonly string[]
  readonly permissionBoundaries: readonly string[]
}

export type TaskSpecification = {
  readonly id: string
  readonly intentId: string
  readonly objective: string
  readonly complexity: TaskComplexity
  readonly risk: TaskRisk
  readonly contextNeed: TaskContextNeed
  readonly tier?: CapabilityTier
  readonly executionConstraints: readonly string[]
  readonly deliverables: readonly string[]
  readonly acceptanceCriteria: readonly string[]
  readonly prohibitions: readonly string[]
  readonly toolRestrictions: readonly string[]
  readonly reportingFormat: string
  readonly sourceRequirements: readonly string[]
}

export type TaskPlan = {
  readonly mode: "resink"
  readonly intentId: string
  readonly tasks: readonly TaskSpecification[]
  readonly dependencies: readonly { readonly from: string; readonly to: string; readonly reason: string }[]
  readonly acceptanceCriteria: readonly string[]
}

export type RoutingDecision = {
  readonly taskId: string
  readonly tier: CapabilityTier
  readonly reasons: readonly string[]
  readonly uncertainty: readonly string[]
  readonly decisionSource: "deterministic" | "manager_reasoner"
  readonly model: ModelRef | null
}

export type WorkerPrompt = {
  readonly taskId: string
  readonly tier: CapabilityTier
  readonly sections: {
    readonly objective: string
    readonly context: string
    readonly scope: string
    readonly deliverables: string
    readonly acceptance: string
    readonly prohibitions: string
    readonly restrictions: string
    readonly reporting: string
  }
  readonly tierGuidance: string
  readonly text: string
}

export type VerificationRequirements = {
  readonly taskId: string
  readonly criteria: readonly string[]
  readonly evidenceExpected: readonly string[]
  readonly passCondition: "all-criteria"
}

export type TaskAnalysis = {
  readonly complexity: TaskComplexity
  readonly risk: TaskRisk
  readonly contextNeed: TaskContextNeed
  readonly tier?: CapabilityTier
  readonly reasons: readonly string[]
  readonly uncertainty: readonly string[]
}

export type ManagerReasoner = {
  planSteps?: (intent: OriginalIntent) => readonly string[] | Promise<readonly string[]>
  analyzeTask?: (task: TaskSpecification, intent: OriginalIntent) => TaskAnalysis | Promise<TaskAnalysis>
}

export type TaskDecisionStatus = "planned" | "needs_review" | "bypassed"

export type ScopeFindingCode =
  | "possible-out-of-scope-action"
  | "ambiguous-instruction"
  | "high-risk-instruction"
  | "high-risk-task"
  | "skipped-non-actionable-item"
  | "no-actionable-task"

export type ScopeFindingSeverity = "advisory" | "review"

/**
 * Advisory finding produced by the natural-language heuristic. Findings never
 * block a decision; review-level findings require a human before dispatch.
 */
export type ScopeFinding = {
  readonly code: ScopeFindingCode
  readonly severity: ScopeFindingSeverity
  readonly message: string
  readonly evidence: string
  readonly taskId?: string
}

export type DispatchReadiness = "ready" | "needs_review" | "not_applicable"

export type TaskDecisionResult = {
  readonly status: TaskDecisionStatus
  readonly reason?: string
  readonly intent: OriginalIntent
  readonly tasks: readonly TaskSpecification[]
  readonly plan: TaskPlan | null
  readonly decisions: readonly RoutingDecision[]
  readonly prompts: readonly WorkerPrompt[]
  readonly verification: readonly VerificationRequirements[]
  readonly scopeFindings: readonly ScopeFinding[]
  readonly reviewReasons: readonly string[]
  readonly readiness: DispatchReadiness
}
