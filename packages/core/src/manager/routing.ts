import type { ModelRef, RoutingDecision, TaskAnalysis, TaskComplexity, TaskContextNeed, TaskRisk, TaskSpecification } from "./contracts.js"
import type { GoatConfig } from "../config.js"

const capabilityTiers = ["L1", "L2", "L3"] as const

function assertCapabilityTier(value: unknown): asserts value is "L1" | "L2" | "L3" {
  if (!capabilityTiers.includes(value as "L1" | "L2" | "L3")) throw new Error(`Invalid capability tier: ${String(value)}`)
}

const highRiskPattern = /\b(?:deploy(?:ment|ing|ed)?|publish(?:ing|ed)?|delete|security|credential|production|migration|database|auth|secret)\b/
const contextTerms = ["repository", "codebase", "multiple files", "multi-file", "across the project", "project-wide"]
const complexityMarkers = [" and ", " then ", " also ", " plus ", " integrate ", " refactor ", " architecture ", " design ", " plan ", " audit ", " test "]

export function analyzeTask(input: {
  objective: string
  constraints?: readonly string[]
  acceptanceCriteria?: readonly string[]
  prohibitions?: readonly string[]
}): TaskAnalysis {
  const text = `${input.objective} ${(input.constraints ?? []).join(" ")} ${(input.acceptanceCriteria ?? []).join(" ")}`.toLowerCase()
  const reasons: string[] = []
  const uncertainty: string[] = ["Model capability metadata is unavailable; routing uses the configured tier policy."]

  let risk: TaskRisk = "low"
  if (highRiskPattern.test(text)) {
    risk = "high"
    reasons.push("High-impact or sensitive terms are present.")
  } else if (/\b(update|modify|change|write|edit|implement|fix)\b/.test(text)) {
    risk = "medium"
    reasons.push("The task changes existing behavior or files.")
  } else {
    reasons.push("No high-impact change terms were detected.")
  }

  let contextNeed: TaskContextNeed = "minimal"
  if (contextTerms.some((term) => text.includes(term)) || input.objective.length > 500) {
    contextNeed = "extensive"
    reasons.push("Broad repository or multi-file context is likely required.")
  } else if (input.objective.length > 150 || (input.constraints?.length ?? 0) > 2) {
    contextNeed = "standard"
    reasons.push("Moderate context is required.")
  } else {
    reasons.push("The task appears locally scoped.")
  }

  let complexity: TaskComplexity = "simple"
  const markerCount = complexityMarkers.reduce((count, marker) => count + (text.includes(marker) ? 1 : 0), 0)
  if (input.objective.length > 600 || markerCount >= 3 || risk === "high" || contextNeed === "extensive") {
    complexity = "complex"
    reasons.push("Multiple steps, broad scope, or high impact indicate complex work.")
  } else if (input.objective.length > 120 || markerCount >= 1 || risk === "medium" || contextNeed === "standard") {
    complexity = "moderate"
    reasons.push("The task has moderate scope or implementation steps.")
  } else {
    reasons.push("The task appears small and direct.")
  }

  if (!(input.acceptanceCriteria?.length)) uncertainty.push("No explicit acceptance criteria were supplied.")
  if (!(input.constraints?.length)) uncertainty.push("No explicit execution constraints were supplied.")
  if (!(input.prohibitions?.length)) uncertainty.push("No explicit prohibitions were supplied.")

  return { complexity, risk, contextNeed, reasons, uncertainty }
}

export function tierForAnalysis(analysis: TaskAnalysis): "L1" | "L2" | "L3" {
  if (analysis.tier !== undefined) {
    assertCapabilityTier(analysis.tier)
    return analysis.tier
  }
  if (analysis.complexity === "complex" || analysis.risk === "high" || analysis.contextNeed === "extensive") return "L3"
  if (analysis.complexity === "moderate" || analysis.risk === "medium" || analysis.contextNeed === "standard") return "L2"
  return "L1"
}

export function tierForTask(task: TaskSpecification): "L1" | "L2" | "L3" {
  if (task.tier !== undefined) {
    assertCapabilityTier(task.tier)
    return task.tier
  }
  const analysis: TaskAnalysis = {
    complexity: task.complexity,
    risk: task.risk,
    contextNeed: task.contextNeed,
    reasons: [],
    uncertainty: [],
  }
  return tierForAnalysis(analysis)
}

export function routeTask(
  task: TaskSpecification,
  config: GoatConfig,
  availableModels?: readonly ModelRef[],
  analysis?: TaskAnalysis,
): { decision: RoutingDecision; checkedAvailability: boolean } {
  const effectiveAnalysis = analysis ?? {
    complexity: task.complexity,
    risk: task.risk,
    contextNeed: task.contextNeed,
    reasons: [`Complexity is ${task.complexity}.`, `Risk is ${task.risk}.`, `Context need is ${task.contextNeed}.`],
    uncertainty: [],
  }
  if (task.tier !== undefined) assertCapabilityTier(task.tier)
  if (effectiveAnalysis.tier !== undefined) assertCapabilityTier(effectiveAnalysis.tier)
  const explicitTier = task.tier ?? effectiveAnalysis.tier
  const tier = explicitTier ?? tierForAnalysis(effectiveAnalysis)
  const role = tier === "L1" ? "l1" : tier === "L2" ? "l2" : "l3"
  const model = config.models[role]
  if (!model) throw new Error(`Missing model assignment for ${tier}`)
  let checkedAvailability = false
  if (availableModels !== undefined) {
    checkedAvailability = true
    if (!availableModels.some((item) => item.providerID === model.providerID && item.modelID === model.modelID)) {
      throw new Error(`Unavailable model for ${tier}: ${model.providerID}/${model.modelID}`)
    }
  }
  const reasons = [
    ...effectiveAnalysis.reasons,
    ...(explicitTier ? [`Explicit tier ${explicitTier} was requested.`] : []),
    `Selected ${tier} from complexity=${effectiveAnalysis.complexity}, risk=${effectiveAnalysis.risk}, and context=${effectiveAnalysis.contextNeed}.`,
  ]
  const uncertainty = [...effectiveAnalysis.uncertainty]
  if (availableModels === undefined) uncertainty.push("Model availability was not verified by the caller.")
  const decision = {
    taskId: task.id,
    tier,
    reasons,
    uncertainty,
    decisionSource: "deterministic" as const,
    model,
  }
  return { decision, checkedAvailability }
}

export function validateManagerModel(config: GoatConfig, availableModels?: readonly ModelRef[]): void {
  if (config.inheritManagerModel) return
  const model = config.models.manager
  if (!model) throw new Error("Missing model assignment for Manager")
  if (availableModels !== undefined && !availableModels.some((item) => item.providerID === model.providerID && item.modelID === model.modelID)) {
    throw new Error(`Unavailable model for Manager: ${model.providerID}/${model.modelID}`)
  }
}

export function tierLabel(tier: "L1" | "L2" | "L3"): string {
  if (tier === "L1") return "L1 (Junior capability)"
  if (tier === "L2") return "L2 (Middle capability)"
  return "L3 (Senior capability)"
}
