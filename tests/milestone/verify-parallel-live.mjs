// Read-only verifier for the Owner-operated palette example. Use the anchor
// and result directory from the completed native tool receipt, not model text.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

const [trace, anchor, directory] = process.argv.slice(2)
assert.ok(trace && /^[a-f0-9]{64}$/.test(anchor) && directory, "Usage: node verify-parallel-live.mjs TRACE HEAD RESULT_DIR")
const hash = value => createHash("sha256").update(value).digest("hex")
const rows = []
let head = ""
for (const line of (await readFile(trace, "utf8")).trim().split("\n")) {
  const { hash: next, ...row } = JSON.parse(line)
  assert.equal(row.previous, head)
  head = hash(JSON.stringify(row))
  assert.equal(next, head)
  rows.push(row)
  if (head === anchor) break
}
assert.equal(head, anchor)
assert.equal(rows.at(-1).event, "terminal")
assert.equal(rows.at(-1).status, "completed")
assert.equal(rows.at(-1).reason, "accepted")
const expected = ["red.py", "green.py", "blue.py", "palette.py"]
const sessions = new Map(), waiting = new Set(), integrated = new Set(), changes = new Map()
let peak = 0, overlap, auditor = 0
for (const row of rows) {
  if (row.event === "dispatch" && row.role === "worker") {
    sessions.set(row.sessionID, row.taskId)
    if (row.taskId === "task-4") for (const id of ["task-1","task-2","task-3"]) assert.ok(integrated.has(id))
  }
  if (row.event === "dispatch" && row.role === "auditor") { assert.equal(integrated.size, 4); auditor++ }
  if (row.event === "integrated") {
    assert.equal(sessions.get(row.sessionID), row.taskId)
    integrated.add(row.taskId)
    for (const f of row.changes) changes.set(f.path, f.sha256)
  }
  if (!sessions.has(row.id)) continue
  if (row.event === "model-request") {
    assert.ok(!waiting.has(row.id), "Missing HTTP response boundary")
    waiting.add(row.id)
    if (waiting.size > peak) { peak = waiting.size; overlap = [...waiting].map(id => ({ id, task: sessions.get(id) })) }
  }
  if (row.event === "model-response") assert.ok(waiting.delete(row.id), "Missing HTTP request boundary")
}
assert.equal(waiting.size, 0)
assert.ok(auditor >= 1 && auditor <= 2)
assert.deepEqual([...changes.keys()].sort(), [...expected].sort())
for (const path of expected) assert.equal(hash(await readFile(join(directory, path))), changes.get(path))
assert.deepEqual(await readFile(join(directory, "test_palette.py")), await readFile(new URL("./parallel-project/test_palette.py", import.meta.url)))
assert.ok(peak >= 2, "No overlapping Worker HTTP request intervals observed on this run")
console.log(JSON.stringify({ verdict: "accepted", peakWorkerHttp: peak, overlap, auditorTurns: auditor, verifiedFiles: expected }, null, 2))
