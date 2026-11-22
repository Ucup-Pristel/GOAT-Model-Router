import assert from "node:assert/strict"
import test from "node:test"
import { inspect } from "node:util"
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
  runtimeEligibility,
  validateRuntimeBudget,
  validateRuntimePolicy,
  type RuntimeAuthorizationPolicy,
  type RuntimeRun,
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

// Property 1: Bug Condition for the runtime lifecycle (DEF-4, DEF-5).
// **Validates: Requirements 1.5, 1.6, 1.7, 1.8, 2.5, 2.6, 2.7, 2.8**

const fixtureIntent = createIntent({ id: "intent-1", instruction: "Update the fixture.", acceptanceCriteria: ["passes"] })

function authorizedRun(): RuntimeRun {
  const run = createRuntimeRun({ id: "run-3", intent: fixtureIntent, task, budget: { ...dryRunBudget, maxModelRequests: 1 } })
  return recordRuntimeAuthorization(run, policy, "filesystem_write", "fixture.txt")
}

// Like assert.throws, but when the call returns instead of throwing, the failure shows what it returned.
function assertFailsClosed(action: () => unknown, expected: RegExp): void {
  let returned: unknown
  try {
    returned = action()
  } catch (error) {
    assert.match(String(error), expected)
    return
  }
  if (returned && typeof returned === "object" && "trace" in returned) {
    const { state, executionDepth, budget } = returned as RuntimeRun
    returned = { state, executionDepth, budget }
  }
  assert.fail(`Expected a throw matching ${expected}, but the call returned ${inspect(returned, { breakLength: Infinity })}`)
}

test("validateRuntimeBudget rejects a budget with missing keys (DEF-4)", () => {
  assertFailsClosed(() => validateRuntimeBudget({ maxDurationMs: 10 } as never), /Invalid runtime budget/)
})

test("validateRuntimeBudget rejects a budget with an unknown key (DEF-4)", () => {
  assertFailsClosed(() => validateRuntimeBudget({ ...dryRunBudget, extra: 1 } as never), /Invalid runtime budget/)
})

test("createRuntimeRun rejects a partial budget (DEF-4)", () => {
  assertFailsClosed(() => createRuntimeRun({ id: "run-3", intent: fixtureIntent, task, budget: { maxDurationMs: 10 } as never }), /Invalid runtime budget/)
})

test("runtimeEligibility rejects a partial budget instead of allowing dispatch (DEF-4)", () => {
  assertFailsClosed(() => runtimeEligibility({ intent: fixtureIntent } as never, task, policy, { maxDurationMs: 10 } as never), /Invalid runtime budget/)
})

test("beginRuntimeRun rejects a hand-built run with a partial budget (DEF-4)", () => {
  assertFailsClosed(() => beginRuntimeRun({ ...authorizedRun(), budget: { maxDurationMs: 10 } as never }, "filesystem_write", "fixture.txt"), /Invalid runtime budget/)
})

test("createRuntimeRun rejects an execution depth above the budget (DEF-5)", () => {
  const budget = { ...dryRunBudget, maxModelRequests: 1, maxExecutionDepth: 1 }
  assertFailsClosed(() => createRuntimeRun({ id: "run-3", intent: fixtureIntent, task, budget, executionDepth: 5 }), /execution depth/)
})

test("beginRuntimeRun rejects a hand-built run whose execution depth exceeds the budget (DEF-5)", () => {
  assertFailsClosed(() => beginRuntimeRun({ ...authorizedRun(), executionDepth: 5 }, "filesystem_write", "fixture.txt"), /execution depth/)
})

test("beginRuntimeRun rejects a hand-built run whose execution depth is NaN (DEF-5)", () => {
  assertFailsClosed(() => beginRuntimeRun({ ...authorizedRun(), executionDepth: Number.NaN }, "filesystem_write", "fixture.txt"), /execution depth/)
})
