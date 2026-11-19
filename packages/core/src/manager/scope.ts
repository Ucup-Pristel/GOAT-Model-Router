import type { OriginalIntent, ScopeFinding, TaskSpecification } from "./contracts.js"
import { isProhibitionText } from "./validate.js"

const outOfScopeAction = /\b(?:deploy(?:ment|ing|ed|s)?|publish(?:ing|ed|es)?|releas(?:e|ing|ed|es)?|ship(?:ping|ped|ment|s)?|push(?:ing|ed|es)?)\b/i

const planningVerbPrefix = /^(?:review(?:ing|ed)?|plan(?:ning|ned)?|document(?:ing|ed)?|test(?:ing|ed)?|read(?:ing)?|check(?:ing|ed)?|open(?:ing|ed)?|summariz(?:e|ing|ed)|translat(?:e|ing|ed)|analyz(?:e|ing|ed)|analys(?:e|ing|ed)|updat(?:e|ing|ed)|writ(?:e|ing)|edit(?:ing|ed)?|improv(?:e|ing|ed)|creat(?:e|ing|ed)|implement(?:ing|ed)?|design(?:ing|ed)?|build(?:ing)?|develop(?:ing|ed)?|fix(?:ing|ed)?|debug(?:ging|ged)?|investigat(?:e|ing|ed)|troubleshoot(?:ing)?|inspect(?:ing|ed)?|audit(?:ing|ed)?|refactor(?:ing|ed)?|migrat(?:e|ing|ed)|ensur(?:e|ing|ed)|verif(?:y|ying|ied)|validat(?:e|ing|ed)|maintain(?:ing|ed)?|support(?:ing|ed)?|add(?:ing|ed)?|remov(?:e|ing|ed)|mak(?:e|ing)|prepar(?:e|ing|ed)|produc(?:e|ing|ed)|cut(?:ting)?)\b/i

// Planning verbs normally suppress advisory findings when they refer to docs,
// plans, scripts, or other non-release artifacts. They must not swallow direct
// release/deploy commands such as "Create the release" or "Update the package".
const directActionVerb = /^(?:creat(?:e|ing|ed)|build(?:ing)?|updat(?:e|ing|ed)|mak(?:e|ing)|prepar(?:e|ing)|produc(?:e|ing)|cut(?:ting)?)\b/i

const safePlanningObject = /^(?:(?:the|a|an|our|my|their|its|new|latest|these|those)\s+)*(?:guide|plans?|docs?|documentation|strategy|checklist|architectures?|designs?|troubleshooting|notes?|polic(?:y|ies)|process|pipeline|scripts?|configuration|config|schedule|timeline|status|report|review|summary|tests?|api|ui|service|updates?|feature flags|features?|boundary|notifications?)\b/i

const pathToken = /(?:[\w.@~-]+\/)+[\w.@~-]+/g

function stripPathTokens(value: string): string {
  return value.replace(pathToken, " ").replace(/\s+/g, " ").trim()
}

function isDirectAction(clause: string): boolean {
  if (!directActionVerb.test(clause)) return false
  const match = outOfScopeAction.exec(clause)
  if (!match) return false
  const rest = clause.slice(match.index + match[0].length).replace(/^\s+/, "")
  return !safePlanningObject.test(rest)
}

const politePrefix = /^(?:please(?:\s+(?:help|make\s+sure))?(?:\s+me)?|kindly|could you(?:\s+kindly)?(?:\s+please)?|can you(?:\s+please)?|would you(?:\s+mind)?|we should|we need to|i need to|i want to|let us|let's|lets)\s+(?:to\s+)?/i

function stripPolitePrefix(value: string): string {
  let result = value.trim()
  for (let index = 0; index < 3; index++) {
    const next = result.replace(politePrefix, "")
    if (next === result) break
    result = next
  }
  return result
}

function splitConnectorActions(segment: string): string[] {
  if (!segment.includes(" ")) return [segment]
  for (const connector of ["+", "&", "/"]) {
    const index = segment.indexOf(connector)
    if (index <= 0) continue
    if (segment[index - 1] === connector || segment[index + 1] === connector) continue
    const left = segment.slice(0, index).trim()
    const right = segment.slice(index + 1).trim()
    const leftWords = left.split(/\s+/).filter(Boolean)
    if (leftWords.length < 2 || leftWords[leftWords.length - 1].length <= 1) continue
    // A slash-joined path fragment is not an action segment.
    if (connector === "/" && /^[\w.-]+\/[\w./-]+$/.test(right) && !right.includes(" ")) continue
    if (outOfScopeAction.test(right)) return [left, ...splitConnectorActions(right)]
  }
  return [segment]
}

const scopeAllowPatterns: readonly RegExp[] = [
  /^(?:deploy(?:ing|ment)?|publish(?:ing)?|releas(?:e|ing)?|ship(?:ping)?)\s+(?:(?:the|a|an|our|my|their|new|latest|these|those)\s+)*(?:guide|plans?|docs?|documentation|strategy|checklist|architectures?|designs?|troubleshooting|notes?|polic(?:y|ies)|process|pipeline|scripts?|configuration|config)\b/,
  /^(?:releas(?:e|ing)?|ship(?:ping)?)\s+(?:(?:the|a|an|our|my|their|new|latest|these|those)\s+)*features?\b/,
  /^push(?:ing)?\s+(?:(?:the|a|an|our|my|their|new|latest|these|those)\s+)*(?:boundary|notifications?|api|ui|service|updates?|feature flags)\b/,
  /^(?:production|staging)\s+deploy(?:ment)?\b/,
  /^(?:the\s+)?(?:deploy(?:ment)?|release|publish|ship|push)\s+(?:(?:is|are|has|needs?)\b|(?:(?:guide|notes?|docs?|documentation|scripts?|service|process|pipeline|build|package|app|application|environment|system)\b.*\b(?:broken|failing|failed|outdated|stale|down|slow|errors?|bugs?|issues?|needs?\s+(?:update|updating|fix|review)|has\s+(?:errors?|bugs?|issues?)|is\s+(?:broken|failing|outdated|down|slow)|are\s+(?:updated|ready|complete|current))\b))/,
  /^(?:the\s+)?(?:deploy(?:ment)?|release|publish|ship|push)\s+(?:guide|notes?|docs?|documentation)\s+needs?\s+(?:update|updating|fix|review)\b/,
]

const statusPredicate = /^(?:the\s+)?(?:deploy(?:ment)?|release|publish(?:ing)?|ship(?:ping)?|push(?:ing)?)\s+(?:is|are|was|were|has|have|had|got|needs?|need|failed|fails?|failing|completed?|succee(?:ded|ds)|broke(?:n)?|passes?|passed|remains?|seems?|looks?)\b/i

const statusNounObject = /^(?:the\s+)?(?:deploy(?:ment)?|release|publish(?:ing)?|ship(?:ping)?|push)\s+(?:notes?|docs?|documentation|scripts?|service|process|pipeline|build|package|app|application|environment|system|guide|plan|strategy|checklist)\b.*\b(?:is|are|was|were|has|have|had|got|needs?|need|failed|failing|broken|outdated|stale|down|slow|wrong|errors?|bugs?|issues?)\b/i

function isStatusReport(clause: string): boolean {
  return statusPredicate.test(clause) || statusNounObject.test(clause)
}

/**
 * Heuristic, advisory scan for possible deployment/publishing actions.
 * Results must not be used as hard execution enforcement; Task 3 owns that.
 */
function collectFindingsFromText(text: string, taskId?: string): ScopeFinding[] {
  const clauses = text
    .split(/[,.;!?\n:]+|->|=>|\s+(?:and|then|also|plus|but|or|however|yet|while|whereas|as well as|along with)\s+|\s+[-—|]\s+|\s+&\s+|\s+\/\s+|\s+\+\s+/i)
    .flatMap(splitConnectorActions)
    .map((clause) => stripPolitePrefix(clause).toLowerCase())
    .filter(Boolean)
  const findings: ScopeFinding[] = []
  const seen = new Set<string>()
  for (const clause of clauses) {
    const detection = stripPathTokens(clause)
    if (!detection) continue
    if (isProhibitionText(detection)) continue
    if (planningVerbPrefix.test(detection) && !isDirectAction(detection)) continue
    if (scopeAllowPatterns.some((pattern) => pattern.test(detection))) continue
    if (isStatusReport(detection)) continue
    if (!outOfScopeAction.test(detection)) continue
    if (seen.has(detection)) continue
    seen.add(detection)
    findings.push({
      code: "possible-out-of-scope-action",
      severity: "review",
      message: `Possible out-of-scope action detected${taskId ? ` in task ${taskId}` : " in the original instruction"}: ${JSON.stringify(clause)}. Human review is required before dispatch; runtime enforcement belongs to Task 3.`,
      evidence: clause,
      ...(taskId ? { taskId } : {}),
    })
  }
  return findings
}

export function collectScopeFindings(task: Pick<TaskSpecification, "id" | "objective">): ScopeFinding[] {
  return collectFindingsFromText(task.objective, task.id)
}

export function collectInstructionFindings(intent: Pick<OriginalIntent, "instruction">): ScopeFinding[] {
  return collectFindingsFromText(intent.instruction)
}

export function collectIntentFindings(intent: OriginalIntent): ScopeFinding[] {
  return intent.ambiguities.map((ambiguity) => ({
    code: "ambiguous-instruction" as const,
    severity: "review" as const,
    message: `Instruction ambiguity requires human review: ${ambiguity}`,
    evidence: ambiguity,
  }))
}

export function collectRiskFindings(task: Pick<TaskSpecification, "id"> & { risk: TaskSpecification["risk"] }): ScopeFinding[] {
  if (task.risk !== "high") return []
  return [{
    code: "high-risk-task",
    severity: "review",
    message: `Task ${task.id} is classified high risk. Human review is required before dispatch.`,
    evidence: "risk=high",
    taskId: task.id,
  }]
}
