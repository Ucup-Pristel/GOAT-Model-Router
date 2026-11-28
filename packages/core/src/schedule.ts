import type { CapabilityTier } from "./manager/contracts.js"

// An empty dependsOn is an explicit Owner assertion of semantic independence.
// Without this signed description the original ordered plan applies.
export type ScheduledTask = {
  objective: string; dependsOn: string[]; read: string[]; write: string[]
  criteria: string[]; tier?: CapabilityTier; suites: string[]
}
export type Schedule = { tasks: ScheduledTask[]; concurrency?: number; maxRequests?: number }
export const taskId = (i: number) => `task-${i + 1}`

export type ScheduledProject = {
  schedule?: Schedule
  files: readonly { path: string; role: "edit" | "read" | "test" }[]
}

export function validateSchedule(project: ScheduledProject, workspace = false) {
  const s = project.schedule
  if (s === undefined) return
  const bounded = (v: unknown, max: number) => typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= max
  const list = (v: unknown): v is string[] => Array.isArray(v) && (workspace || v.length <= 20) &&
    v.every(x => typeof x === "string" && x.trim() && x.length <= 512) && new Set(v).size === v.length
  if (!s || Object.keys(s).some(k => !["tasks","concurrency","maxRequests"].includes(k)) ||
    !Array.isArray(s.tasks) || !bounded(s.tasks.length, 4) ||
    !bounded(s.concurrency === undefined ? 3 : s.concurrency, 4) ||
    !bounded(s.maxRequests === undefined ? 48 : s.maxRequests, 48)) throw Error("Invalid signed schedule")
  const ids = s.tasks.map((_, i) => taskId(i))
  const writers = new Map<string, string>()
  for (const [i, t] of s.tasks.entries()) {
    if (!t || Object.keys(t).some(k => !["objective","dependsOn","read","write","criteria","tier","suites"].includes(k)) ||
      typeof t.objective !== "string" || !t.objective.trim() || t.objective !== t.objective.trim() || !workspace && t.objective.length > 512 ||
      t.tier !== undefined && !["L1","L2","L3"].includes(t.tier) ||
      !list(t.dependsOn) || !t.dependsOn.every(id => ids.includes(id)) ||
       !list(t.criteria) || !t.criteria.length || !list(t.write) || !list(t.read) || !list(t.suites) ||
      !t.suites.every(path => project.files.some(f => f.role === "test" && f.path === path)) ||
      !t.read.every(path => !t.write.includes(path) && project.files.some(f => f.path === path)) ||
      !t.write.every(path => project.files.some(f => f.path === path && f.role === "edit"))) throw Error(`Invalid scope or dependency for ${ids[i]}`)
    for (const path of t.write) {
      if (writers.has(path)) throw Error(`Write/write conflict: ${ids[i]}.write lists ${path}, already assigned to ${writers.get(path)}; use one writer`)
      writers.set(path, ids[i])
    }
  }
  const ancestors = new Map<string, Set<string>>()
  while (ancestors.size < ids.length) {
    const i = s.tasks.findIndex((t, j) => !ancestors.has(ids[j]) && t.dependsOn.every(id => ancestors.has(id)))
    if (i < 0) throw Error("Signed schedule has a dependency cycle")
    const t = s.tasks[i]
    const prior = new Set(t.dependsOn.flatMap(id => [id, ...ancestors.get(id)!]))
    for (const path of t.read) {
      const writer = writers.get(path)
      if (writer && !prior.has(writer)) throw Error(`Read/write conflict: ${ids[i]}.read lists ${path}; its writer ${writer} must be a predecessor in dependsOn`)
    }
    ancestors.set(ids[i], prior)
  }
}

// Scan in Owner order whenever a slot opens. Completed means the task's
// change set was integrated, not merely that the model finished speaking.
export async function runReady(deps: readonly string[][], limit: number, selected: Set<number>,
  run: (i: number) => Promise<void>, interrupt?: () => void) {
  const pending = new Set(deps.map((_, i) => i).filter(i => selected.has(i)))
  const done = new Set(deps.flatMap((_, i) => selected.has(i) ? [] : [taskId(i)]))
  const active = new Map<number, Promise<void>>()
  let failure: { error: unknown } | undefined
  try {
    while (pending.size || active.size) {
      if (failure) break
      for (const i of pending) {
        if (active.size >= limit) break
        if (!deps[i].every(id => done.has(id))) continue
        pending.delete(i)
        active.set(i, run(i).then(() => { done.add(taskId(i)) }, error => {
          if (!failure) { failure = { error }; interrupt?.() }
          else if (failure.error instanceof Error && failure.error.name === "AbortError") failure = { error }
        })
          .finally(() => active.delete(i)))
      }
      if (!active.size) throw Error("No ready task in signed schedule")
      await Promise.race(active.values())
    }
  } finally { await Promise.all(active.values()) }
  if (failure) throw failure.error
}
