import { createHash } from "node:crypto"
import type { ScheduledTask } from "./schedule.js"

export type ProjectFile = { path: string; source: string | null; role: "edit" | "read" | "test" }
export const digest = (text: string) => createHash("sha256").update(text).digest("hex")
// Refusals made by the broker without reading or modifying file contents.
export class ProjectFileRefusal extends Error {}

// No filesystem capability is passed to a scheduled Worker. All reads and
// writes are against this bounded change set; commit is synchronous.
export function projectSnapshot(files: ProjectFile[], t: ScheduledTask) {
  const scoped = files.filter(f => t.read.includes(f.path) || t.write.includes(f.path))
    .map(f => ({ ...f, role: t.write.includes(f.path) ? "edit" as const : "read" as const }))
  const staged = new Map<string, string>()
  return { files: scoped,
    async read(path?: string) {
      const f = scoped.find(f => f.path === path)
      if (!f) throw Error("Outside assigned files")
      const value = staged.get(f.path) ?? f.source
      if (value === null) throw new ProjectFileRefusal("Assigned new file does not exist yet")
      return value
    },
    async replace(source: string, path?: string) {
      if (!path || !t.write.includes(path) || Buffer.byteLength(source) > 16384) throw Error("Outside assigned writes")
      staged.set(path, source)
    },
    commit(requireChange: boolean) {
      for (const input of scoped) {
        if (files.find(f => f.path === input.path)!.source !== input.source) throw Error(`Stale task snapshot: ${input.path}`)
      }
      const changes = scoped.filter(f => staged.has(f.path) && staged.get(f.path) !== f.source)
      if (requireChange && !changes.length) throw Error("Worker produced no scoped change")
      return changes.map(f => {
        const source = staged.get(f.path)!
        files.find(file => file.path === f.path)!.source = source
        return { path: f.path, sha256: digest(source) }
      })
    } }
}
