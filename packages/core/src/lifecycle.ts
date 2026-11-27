export type TaskState = "queued" | "classifying" | "delegated" | "auditing" | "completed" | "retrying" | "escalated" | "failed" | "cancelled"

const transitions: Record<TaskState, readonly TaskState[]> = {
  queued: ["classifying", "cancelled"],
  classifying: ["delegated", "failed", "cancelled"],
  delegated: ["auditing", "retrying", "escalated", "failed", "cancelled"],
  auditing: ["completed", "retrying", "escalated", "failed", "cancelled"],
  retrying: ["delegated", "escalated", "failed", "cancelled"],
  escalated: ["delegated", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return transitions[from].includes(to)
}
