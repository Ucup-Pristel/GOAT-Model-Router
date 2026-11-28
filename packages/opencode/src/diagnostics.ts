import { digest, type TaskDecisionResult } from "@goatmr/core"

export function readinessDetails(plan: TaskDecisionResult) {
  return {readiness:plan.readiness,
    reviewReasons:[...new Set(plan.scopeFindings.filter(f => f.severity === "review").map(f => f.code))],
    scopeFindings:plan.scopeFindings.map(f => ({code:f.code,severity:f.severity,...(f.taskId && {taskId:f.taskId}),evidenceSha256:digest(f.evidence)})),
    selections:plan.decisions.map(d => ({taskId:d.taskId,tier:d.tier,model:d.model}))}
}

// No arbitrary exception messages, stack traces, prompts, tool arguments or
// provider bodies in diagnostics. The fingerprint correlates local failures.
export function failureDetails(error: unknown, phase: string, signal?: AbortSignal) {
  const message = error instanceof Error ? error.message : String(error)
  const code = signal?.aborted ? signal.reason?.name === "TimeoutError" ? "GOAT_TIMEOUT" : "GOAT_CANCELLED" :
    message === "needs_review" ? "GOAT_NEEDS_REVIEW" :
    /protected/i.test(message) ? "GOAT_PROTECTED_INPUT" :
    /permission|authorization|capability|outside|denied/i.test(message) ? "GOAT_PERMISSION_DENIED" :
    /unavailable|missing|incompatible/i.test(message) ? "GOAT_UNAVAILABLE" :
    /budget|limit/i.test(message) ? "GOAT_BUDGET_EXHAUSTED" : "GOAT_EXECUTION_FAILED"
  const descriptions: Record<string,string> = {
    GOAT_TIMEOUT:"The execution deadline was reached.",GOAT_CANCELLED:"The caller or GOAT policy cancelled execution.",
    GOAT_NEEDS_REVIEW:"Readiness requires review; inspect reviewReasons and scopeFindings.",
    GOAT_PROTECTED_INPUT:"A write or check entrypoint conflicts with protected verification or policy input.",
    GOAT_PERMISSION_DENIED:"An operation is outside its approved capability or was rejected.",
    GOAT_UNAVAILABLE:"A required model, tool, input or execution prerequisite is unavailable.",
    GOAT_BUDGET_EXHAUSTED:"A bounded request, operation or context budget was exhausted.",
    GOAT_EXECUTION_FAILED:"Execution failed in the recorded phase; correlate the error fingerprint with local host diagnostics.",
  }
  return {phase,code,message:descriptions[code],errorType:error instanceof Error && ["Error","AbortError","TimeoutError"].includes(error.name) ? error.name : "Error",
    errorSha256:digest(message),...(signal?.aborted && {stopReason:code === "GOAT_TIMEOUT" ? "deadline" : "cancellation"})}
}

// Preserve established private-profile receipts only for known, data-free
// errors. Unknown provider/tool messages are never forwarded.
export function failureReason(error:unknown, code:string) {
  const message = error instanceof Error ? error.message : ""
  if (["needs_review","Missing or non-independent role assignment","File tool result not confirmed by broker",
    "Invalid owner signature","Invalid source session or execution depth","Session profile mismatch",
    "Observed role token budget exceeded"].includes(message) || /^Missing model assignment for L[123]$/.test(message)) return message
  if (/^(?:Invalid signed schedule|Invalid scope or dependency|Signed schedule has a dependency cycle|Write\/write conflict|Read\/write conflict)/.test(message)) return "Invalid scope or dependency conflict"
  return code
}
