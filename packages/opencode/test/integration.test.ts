import assert from "node:assert/strict"
import test from "node:test"
import { projectSnapshot, syncProject, type ProjectTask } from "../src/project.js"
import { runReady } from "../src/schedule.js"

test("cancellation, expiry or a stale disk image prevents materialization", async () => {
  const disk: ProjectTask["files"] = ["a","b"].map(path => ({ path, source: "old", role: "edit" }))
  const integrated = disk.map(f => ({ ...f, source: "new" }))
  for (const fault of ["off", "expired", "stale"]) {
    const controller = new AbortController()
    let writes = 0
    const ws = { async read(path?: string) {
      if (fault === "off") controller.abort()
      return fault === "stale" && path === "b" ? "changed" : "old"
    }, async replace() { writes++ } }
    await assert.rejects(syncProject(ws, disk, integrated, controller.signal, fault === "expired" ? 0 : Date.now()+60000),
      /abort|expired|Stale/i)
    assert.equal(writes, 0)
  }
})

test("stale input invalidates the whole in-memory Worker change set", async () => {
  const files: ProjectTask["files"] = [{ path: "input", source: "old", role: "read" }, { path: "result", source: null, role: "edit" }]
  const snapshot = projectSnapshot(files, { objective: "create result", dependsOn: [], criteria: ["result matches input"],
    read: ["input"], write: ["result"], suites: [] })
  await snapshot.replace("old", "result")
  files[0].source = "new"
  assert.throws(() => snapshot.commit(true), /Stale task snapshot: input/)
  assert.equal(files[1].source, null)
})

test("interrupt drains active siblings and reports failed cleanup over ordinary cancellation", async () => {
  let stop!: () => void
  const interrupted = new Promise<void>(resolve => { stop = resolve })
  const started: number[] = []
  await assert.rejects(runReady([[], [], ["task-1"]], 2, new Set([0,1,2]), async i => {
    started.push(i)
    if (i === 0) throw new DOMException("interrupted", "AbortError")
    await interrupted
    throw Error("Session cleanup failed; host quarantined")
  }, stop), /quarantined/)
  assert.deepEqual(started, [0,1])
})
