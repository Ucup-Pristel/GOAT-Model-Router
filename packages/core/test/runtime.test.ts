import assert from "node:assert/strict"
import test from "node:test"
import {
  assertRuntimeBudget,
  authorizeRuntimeOperation,
  beginRuntimeRun,
  cancelRuntimeRun,
  createIntent,
  createRuntimeRun,
  denyAllRuntimePolicy,
  dryRunBudget,
  recordRuntimeAuthorization,
  validateRuntimeBudget,
  validateRuntimePolicy,
  type RuntimeAuthorizationPolicy,
  type TaskSpecification,
} from "../src/index.js"

const task: TaskSpecification = {
  id: "task-1", intentId: "intent-1", objective: "Update the fixture.", complexity: "simple", risk: "low", contextNeed: "minimal",
  executionConstraints: [], deliverables: ["fixture"], acceptanceCriteria: ["passes"], prohibitions: [], toolRestrictions: [], reportingFormat: "report", sourceRequirements: ["intent:intent-1"],
}

const policy: RuntimeAuthorizationPolicy = {
  hostAllowed: ["filesystem_read", "filesystem_write"],
  taskAllowed: ["filesystem_read", "filesystem_write"],
}

test("runtime authorization intersects host, owner, and task policies fail-closed", () => {
  assert.equal(authorizeRuntimeOperation(policy, "filesystem_read").allowed, true)
  assert.equal(authorizeRuntimeOperation(policy, "network").allowed, false)
  assert.equal(authorizeRuntimeOperation({ ...policy, hostAllowed: [...policy.hostAllowed, "deploy"], taskAllowed: [...policy.taskAllowed, "deploy"] }, "deploy").allowed, false)
  assert.equal(authorizeRuntimeOperation(denyAllRuntimePolicy, "filesystem_read").allowed, false)
})

test("runtime lifecycle cannot execute before authorization and stops at budgets or cancellation", () => {
  const intent = createIntent({ id: "intent-1", instruction: "Update the fixture.", acceptanceCriteria: ["passes"] })
  const run = createRuntimeRun({ id: "run-1", intent, task, budget: { ...dryRunBudget, maxModelRequests: 1, maxDurationMs: 10 } })
  assert.throws(() => beginRuntimeRun(run, "filesystem_write", "fixture.txt"), /authorized/)
  const blocked = recordRuntimeAuthorization(run, policy, "network", "https://example.invalid")
  assert.equal(blocked.state, "blocked")
  const authorized = recordRuntimeAuthorization(run, policy, "filesystem_write", "fixture.txt")
  const running = beginRuntimeRun(authorized, "filesystem_write", "fixture.txt", 100)
  assert.equal(running.state, "running")
  assert.equal(assertRuntimeBudget(running, 111).state, "blocked")
  assert.equal(cancelRuntimeRun(running, "owner cancelled").state, "cancelled")
})

test("runtime contracts reject invalid budgets and policies", () => {
  assert.throws(() => validateRuntimeBudget({ ...dryRunBudget, maxModelRequests: -1 }), /budget/)
  assert.throws(() => validateRuntimePolicy({ ...policy, hostAllowed: ["not-an-operation" as never] }), /authorization policy/)
})

test("high-impact operations stay disabled despite forged policy and authorization is resource-bound", () => {
  const forgedPolicy: RuntimeAuthorizationPolicy = { hostAllowed: ["deploy"], taskAllowed: ["deploy"] }
  assert.equal(authorizeRuntimeOperation(forgedPolicy, "deploy").allowed, false)
  const intent = createIntent({ id: "intent-1", instruction: "Update the fixture.", acceptanceCriteria: ["passes"] })
  const run = recordRuntimeAuthorization(createRuntimeRun({ id: "run-2", intent, task, budget: { ...dryRunBudget, maxModelRequests: 1 } }), policy, "filesystem_write", "fixture.txt")
  assert.throws(() => beginRuntimeRun(run, "filesystem_write", "other.txt"), /resource/)
})

test("advisory Task 2 readiness cannot grant runtime operation permission", () => {
  const maliciousPolicy: RuntimeAuthorizationPolicy = {
    hostAllowed: ["filesystem_read"], taskAllowed: ["filesystem_read"],
  }
  assert.equal(authorizeRuntimeOperation(maliciousPolicy, "destructive").allowed, false)
  assert.equal(authorizeRuntimeOperation(maliciousPolicy, "credential").allowed, false)
  assert.equal(authorizeRuntimeOperation(maliciousPolicy, "git_push").allowed, false)
})
