export type ModelRef = { providerID: string; modelID: string }
export type GoatConfig = {
  version: 1
  enabled: boolean
  mode: "standard" | "resink"
  inheritManagerModel: boolean
  models: { manager?: ModelRef; l1?: ModelRef; l2?: ModelRef; l3?: ModelRef; auditor?: ModelRef }
}

export const defaults: GoatConfig = { version: 1, enabled: false, mode: "standard", inheritManagerModel: true, models: {} }

export function validateConfig(value: unknown): GoatConfig {
  if (!value || typeof value !== "object") return structuredClone(defaults)
  const input = value as Record<string, unknown>
  if (input.version !== 1 || typeof input.enabled !== "boolean" || !["standard", "resink"].includes(String(input.mode)) || (input.inheritManagerModel !== undefined && typeof input.inheritManagerModel !== "boolean")) return structuredClone(defaults)
  if (!input.models || typeof input.models !== "object" || Array.isArray(input.models)) return structuredClone(defaults)
  const models: GoatConfig["models"] = {}
  const source = input.models as Record<string, unknown>
  if (["manager", "l1", "l2", "l3", "auditor"].some((role) => source[role] !== undefined && (!source[role] || typeof source[role] !== "object" || typeof (source[role] as ModelRef).providerID !== "string" || !(source[role] as ModelRef).providerID || typeof (source[role] as ModelRef).modelID !== "string" || !(source[role] as ModelRef).modelID))) return structuredClone(defaults)
  for (const role of ["manager", "l1", "l2", "l3", "auditor"] as const) {
    const ref = source[role]
    if (ref && typeof ref === "object" && typeof (ref as ModelRef).providerID === "string" && (ref as ModelRef).providerID.length > 0 && typeof (ref as ModelRef).modelID === "string" && (ref as ModelRef).modelID.length > 0) models[role] = { providerID: (ref as ModelRef).providerID, modelID: (ref as ModelRef).modelID }
  }
  return { version: 1, enabled: input.enabled, mode: input.mode as GoatConfig["mode"], inheritManagerModel: input.inheritManagerModel !== false, models }
}

export function modelStatus(model: ModelRef | undefined, available: readonly ModelRef[]): string {
  if (!model) return "unconfigured"
  return available.some((item) => item.providerID === model.providerID && item.modelID === model.modelID)
    ? `${model.providerID}/${model.modelID}`
    : `${model.providerID}/${model.modelID} (unavailable)`
}
