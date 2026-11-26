import { appendFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { digest } from "./project.js"

// Synchronous append serializes concurrent hooks in this private host. No
// model inputs or file contents belong in the journal. The receipt anchors it.
export function openTrace() {
  const path = join(mkdtempSync(join(tmpdir(), "goat-trace-")), "events.jsonl")
  let head = "", seq = 0
  return { path, get head() { return head }, record(event: string, fields: Record<string, unknown> = {}) {
    const body = { seq: seq + 1, previous: head, time: Date.now(), event, ...fields }
    const hash = digest(JSON.stringify(body))
    appendFileSync(path, JSON.stringify({ ...body, hash }) + "\n", { mode: 0o600 })
    head = hash; seq++
  } }
}
