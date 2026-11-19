import assert from "node:assert/strict"
import test from "node:test"
import { canTransition } from "../src/index.js"

test("task lifecycle allows audit pass and rejects terminal-state reuse", () => {
  assert.equal(canTransition("delegated", "auditing"), true)
  assert.equal(canTransition("auditing", "completed"), true)
  assert.equal(canTransition("completed", "retrying"), false)
})
