import type { OriginalIntent, TaskPlan, TaskSpecification } from "./contracts.js"
import { analyzeTask } from "./routing.js"
import { assertTaskInScope, isProhibitionText, validateTaskPlan, validateTaskSpecification } from "./validate.js"

const defaultReportingFormat = "Report the completed work, evidence, tests or checks performed, unresolved risks, and any deviation from the assigned scope."

function taskFromObjective(intent: OriginalIntent, objective: string, index: number, source: string, acceptanceCriteria: readonly string[] = intent.acceptanceCriteria): TaskSpecification {
  const analysis = analyzeTask({
    objective,
    constraints: intent.constraints,
    acceptanceCriteria,
    prohibitions: intent.prohibitions,
  })
  const task = validateTaskSpecification({
    id: `task-${index + 1}`,
    intentId: intent.id,
    objective,
    complexity: analysis.complexity,
    risk: analysis.risk,
    contextNeed: analysis.contextNeed,
    executionConstraints: intent.constraints,
    deliverables: ["Completed the assigned task and reported evidence."],
    acceptanceCriteria,
    prohibitions: intent.prohibitions,
    toolRestrictions: intent.permissionBoundaries,
    reportingFormat: defaultReportingFormat,
    sourceRequirements: [`intent:${intent.id}`, source],
  })
  assertTaskInScope(task)
  return task
}

function userPlanObjectives(intent: OriginalIntent, userPlan: readonly string[]): string[] {
  return userPlan.map((item) => item.trim()).filter(Boolean)
}

function explicitListObjectives(instruction: string): string[] {
  const lines: string[] = []
  let fenced = false
  for (const line of instruction.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }
    if (!fenced) lines.push(line)
  }
  return lines
    .filter((line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
}

function isNonActionableLine(value: string): boolean {
  let line = value.trim()
  if (!line) return true
  line = line.replace(/^#{1,6}\s+/, "").trim()
  if (/^(?:-{3,}|\*{3,}|={3,})$/.test(line)) return true
  if (/^(?:n\/?a|none|tbd)$/i.test(line)) return true
  if (/^\s*(?:constraints?|notes?|requirements?|rules?|context|scope|acceptance criteria|prohibitions?|instructions?|deliverables?|goals?|approach|implementation|implementation details|plans?|designs?|architectures?|risks?|dependencies|testing|tests?|quality|security|performance|documentation|references?|summary|overview|background|objectives?|tasks?|steps?|next steps|timeline|milestones?|acceptance|review|verification|challenges?|open questions?|success criteria|assumptions?|non-goals?|out of scope|notes and constraints|constraints and notes|risks and mitigations|open issues?|action items?|follow-ups?|decisions?|testing strategy|test plan|validation|rollout|migration plan|known issues?|open risks?|next actions?|action plan|success metrics|key risks?|questions?|mitigations?|risks\/mitigations|assumptions and risks|notes and risks|open questions and risks|review notes|testing notes|known problems?|open problems?|key questions?|unknowns?|constraints and assumptions|risks and assumptions|notes and assumptions|questions and answers|action items and owners|follow-up items|decisions and open questions|test results|testing summary|validation results|rollout plan|migration steps)\s*:?\s*$/i.test(line)) return true
  const labeled = line.match(/^[A-Za-z][\w /-]*:\s*(.+)$/)
  if (labeled && isProhibitionText(labeled[1])) {
    const content = labeled[1]
    if (!/(?:[,;:.+&]|\b(?:and|then|but|or|however|yet)\s+)/i.test(content)) return true
  }
  return false
}

function actionableObjective(item: string): string | null {
  const value = item.trim()
  if (isNonActionableLine(value)) return null
  if (/^not only\b/i.test(value)) return value
  const labeledProhibition = value.match(/^[A-Za-z][\w /-]*:\s*(.+)$/)
  if (labeledProhibition && isProhibitionText(labeledProhibition[1])) {
    const content = labeledProhibition[1]
    const combinedContent = content.match(/^(.+?)(?:\s*,\s*but\s+|\s+(?:but|and|then|or|however|yet)\s+|\s*[,;:.+&]\s*)(.+)$/)
    if (!combinedContent) return null
    const action = combinedContent[2].trim()
    if (/^(?:unless|if|when|because|until|except)\b/i.test(action)) return null
    return action
  }
  const labeled = value.match(/^(prohibited|forbidden|no|never|avoid|without|not)\s*:\s*(.+)$/i)
  if (labeled) {
    const segments = labeled[2]
      .split(/\s*(?:[,;:.+&]|\bbut\b|\band\b|\bthen\b|\bor\b|\bhowever\b|\byet\b)\s*/i)
      .map((segment) => segment.trim())
      .filter(Boolean)
    const actions = segments.slice(1).filter((segment) => !isProhibitionText(segment) && !/^(?:unless|if|when|because|until|except)\b/i.test(segment))
    return actions.length > 0 ? actions.join(", ") : null
  }
  const combined = value.match(/^(.+?)(?:\s*,\s*but\s+|\s+(?:but|and|then|or|however|yet)\s+|\s*[,;:.+&]\s*)(.+)$/)
  if (combined && isProhibitionText(combined[1])) {
    if (/^(?:prohibited|forbidden|no|not|never|avoid|without)\s*$/i.test(combined[1])) return null
    const action = combined[2].trim()
    if (/^(?:unless|if|when|because|until|except)\b/i.test(action)) return null
    return action
  }
  return isProhibitionText(value) ? null : value
}

function nonListProse(instruction: string): string {
  const lines: string[] = []
  let fenced = false
  for (const line of instruction.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }
    if (!fenced && !/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) lines.push(line)
  }
  return lines.join("\n").trim()
}

function actionableProseLines(prose: string): string[] {
  return prose
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line && !isNonActionableLine(line))
    .map(actionableObjective)
    .filter((line): line is string => Boolean(line))
}

function dependenciesFor(tasks: readonly TaskSpecification[]): { from: string; to: string; reason: string }[] {
  return tasks.slice(1).map((task, index) => ({
    from: tasks[index].id,
    to: task.id,
    reason: "sequential execution; later tasks assume earlier task output",
  }))
}

export function planStandard(
  intent: OriginalIntent,
  userPlan: readonly string[] | null = intent.userPlan,
): { tasks: TaskSpecification[]; preservedUserPlan: boolean } {
  const planned = userPlan ? userPlanObjectives(intent, userPlan) : []
  if (planned.length > 0) {
    return {
      tasks: planned.map((objective, index) => taskFromObjective(intent, objective, index, `user-plan:${index + 1}`)),
      preservedUserPlan: true,
    }
  }
  return {
    tasks: [taskFromObjective(intent, intent.outcome, 0, "intent:outcome")],
    preservedUserPlan: false,
  }
}

export function planResink(
  intent: OriginalIntent,
  userPlan: readonly string[] | null = intent.userPlan,
): TaskPlan {
  const preserved = userPlan ? userPlanObjectives(intent, userPlan) : []
  const listed = preserved.length > 0 ? [] : explicitListObjectives(intent.instruction)
  const actionable = listed.map(actionableObjective).filter((item): item is string => Boolean(item))
  const proseLines = listed.length > 0 ? actionableProseLines(nonListProse(intent.instruction)) : []
  if (listed.length > 0 && actionable.length === 0 && proseLines.length === 0) {
    throw new Error("No actionable task found: every explicit list item is a constraint or prohibition")
  }
  const objectives = preserved.length > 0
    ? preserved
    : actionable.length > 0
      ? actionable
      : proseLines.length > 0
        ? [proseLines.join("\n")]
        : [intent.instruction.trim()]
  const acceptanceCriteria = intent.acceptanceCriteria.length > 0
    ? intent.acceptanceCriteria
    : ["Complete the requested outcome without violating prohibitions or expanding scope."]
  const tasks = objectives.map((objective, index) => taskFromObjective(
    intent,
    objective,
    index,
    preserved.length > 0 ? `user-plan:${index + 1}` : actionable.length > 0 ? `resink-list:${index + 1}` : proseLines.length > 0 ? "resink:prose" : "resink:instruction",
    acceptanceCriteria,
  ))
  const plan: TaskPlan = {
    mode: "resink",
    intentId: intent.id,
    tasks,
    dependencies: preserved.length > 0 ? [] : dependenciesFor(tasks),
    acceptanceCriteria,
  }
  return validateTaskPlan(plan)
}
