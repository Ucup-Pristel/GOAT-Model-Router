import { createHash } from "node:crypto"
import type { OriginalIntent } from "./contracts.js"
import { validateOriginalIntent } from "./validate.js"

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value)
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  }
  return value
}

export function createIntent(input: {
  instruction: string
  outcome?: string
  constraints?: readonly string[]
  prohibitions?: readonly string[]
  userPlan?: readonly string[] | null
  acceptanceCriteria?: readonly string[]
  ambiguities?: readonly string[]
  permissionBoundaries?: readonly string[]
  id?: string
}): OriginalIntent {
  if (typeof input.instruction !== "string" || !input.instruction.trim()) throw new Error("Invalid intent: instruction is required")
  if (input.outcome !== undefined && typeof input.outcome !== "string") throw new Error("Invalid intent: outcome must be a string")
  const normalize = (items: readonly string[] | undefined, field: string): string[] => {
    const values = (items ?? []).map((item) => item.trim())
    if (values.some((item) => !item)) throw new Error(`Invalid intent: ${field} contains a blank entry`)
    return values
  }
  const constraints = normalize(input.constraints, "constraints")
  const prohibitions = normalize(input.prohibitions, "prohibitions")
  const acceptanceCriteria = normalize(input.acceptanceCriteria, "acceptanceCriteria")
  const ambiguities = normalize(input.ambiguities, "ambiguities")
  const permissionBoundaries = normalize(input.permissionBoundaries, "permissionBoundaries")
  const userPlan = input.userPlan === undefined || input.userPlan === null ? null : input.userPlan.map((item) => item.trim())
  if (!input.outcome && acceptanceCriteria.length === 0) ambiguities.push("Requested outcome was not explicitly stated; derived from the original instruction.")
  if (acceptanceCriteria.length === 0) ambiguities.push("No explicit acceptance criteria were supplied.")
  if (input.instruction.trim().length < 24) ambiguities.push("The instruction is very short; confirm scope before execution.")
  const identity = {
    instruction: input.instruction,
    outcome: input.outcome?.trim() || input.instruction,
    constraints,
    prohibitions,
    userPlan,
    acceptanceCriteria,
    ambiguities,
    permissionBoundaries,
  }
  const id = input.id ?? `intent-${createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 12)}`
  return deepFreeze(validateOriginalIntent({ id, ...identity }))
}

export function cloneIntent(intent: OriginalIntent): OriginalIntent {
  return deepFreeze(validateOriginalIntent(JSON.parse(JSON.stringify(intent))))
}

export function intentFingerprint(intent: OriginalIntent): string {
  return JSON.stringify(intent)
}
