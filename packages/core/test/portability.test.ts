import assert from "node:assert/strict"
import test from "node:test"
import { decideTask, defaults, digest, executePlan, projectSnapshot, RoleBudget, taskId,
  type CapabilityTier, type ExecutionHost, type ExecutionOptions, type ProjectFile, type ScheduledTask } from "../src/index.js"

const ref = (modelID: string) => ({ providerID: "memory", modelID })
const models = { l1: ref("junior"), l2: ref("middle"), l3: ref("senior"), auditor: ref("reviewer") }

// Only host operations are simulated: scoped edits, measured checks, and an
// independent reviewer that sees the audit packet but has no file capability.
async function fixture(tiers: CapabilityTier[], defect = false, maxRequests = 48) {
  const files: ProjectFile[] = tiers.map((_, i) => ({ path: `file-${i}`, role: "edit", source: null }))
  files.push({ path: "check", role: "test", source: "expect correct" })
  const tasks: ScheduledTask[] = tiers.map((tier, i) => ({
    objective: `Set the correct value for item ${i}`, criteria: ["Correct value"], tier, suites: ["check"],
    dependsOn: i === 2 ? [taskId(0)] : [], read: i === 2 ? ["file-0"] : [], write: [files[i].path],
  }))
  const objectives = tasks.map(t => t.objective)
  const plan = await decideTask({ instruction: objectives.join("; "), userPlan: objectives, assignments: tasks, acceptanceCriteria: ["All values are correct"],
    config: { ...defaults, enabled: true, models }, availableModels: Object.values(models) })
  const options: ExecutionOptions = { states: ["queued", "classifying"], models,
    rework: true, budget: new RoleBudget(maxRequests), verification: { kind: "project", project: { files, schedule: { tasks, concurrency: 2, maxRequests } } } }
  const controller = new AbortController()
  const calls: [number, number, string, CapabilityTier][] = []
  const audits: string[] = []
  const inputs: string[] = []
  let active = 0, peak = 0
  const host: ExecutionHost = {
    inventory: Object.values(models).map(m => ({ ...m, tools: m !== models.auditor })),
    signal: controller.signal,
    interruptWorkers: () => controller.abort(),
    async runWorker({ scope, model, tier, index, attempt, reserve, text }) {
      reserve()
      calls.push([index, attempt, model.modelID, tier])
      peak = Math.max(peak, ++active)
      try {
        const snapshot = projectSnapshot(files, scope!)
        if (index === 2) {
          inputs.push(await snapshot.read("file-0"))
          assert.ok(text.includes(`"report":"report 0/${attempt}"`))
        }
        await snapshot.replace(defect && index === 0 && attempt === 1 ? "incorrect" : "correct", scope!.write[0])
        controller.signal.throwIfAborted()
        snapshot.commit(attempt === 1)
        return `report ${index}/${attempt}`
      } finally { active-- }
    },
    verification: {
      suiteResource: suite => suite,
      async inspect() {
        const passed = files.filter(f => f.role === "edit").every(f => f.source === "correct")
        return { passed, sha256: digest(JSON.stringify(files)), results: [{ suite: "check", passed, count: 1 }] }
      },
    },
    async audit({ text, model, reserve }) {
      reserve()
      audits.push(model.modelID)
      const packet = JSON.parse(text.slice(text.indexOf("\n") + 1))
      const { taskId, attempt, criteria, reportSha256, evidence } = packet
      return JSON.stringify({ taskId, attempt, criterion: criteria[0], reportSha256, sha256: evidence.sha256,
        outcome: evidence.passed ? "PASS" : "FAIL", riskReview: "Compared the protected check with the requested result.",
        findings: evidence.passed ? [] : [{ kind: "scoped-defect", taskId: "task-1", suite: "check", detail: "Incorrect value" }] })
    },
  }
  return { run: () => executePlan(plan, options, host), options, host, calls, audits, inputs, files, controller, peak: () => peak }
}

test("one in-memory task is integrated, measured and accepted by a separate Auditor", async () => {
  const f = await fixture(["L1"])
  assert.equal(await f.run(), "accepted")
  assert.deepEqual(f.calls, [[0, 1, "junior", "L1"]])
  assert.deepEqual(f.audits, ["reviewer"])
  assert.equal(f.files[0].source, "correct")
  assert.equal(f.options.budget.requests, 2)
  assert.deepEqual(f.options.states, ["queued", "classifying", "delegated", "auditing", "completed"])
})

test("same-tier Workers overlap; a mixed-tier dependent waits for the integrated input", async () => {
  const f = await fixture(["L1", "L1", "L3"])
  assert.equal(await f.run(), "accepted")
  assert.equal(f.peak(), 2)
  assert.deepEqual(f.calls, [[0, 1, "junior", "L1"], [1, 1, "junior", "L1"], [2, 1, "senior", "L3"]])
  assert.deepEqual(f.inputs, ["correct"])
})

test("reproduced finding reruns only its Worker and descendant, each one tier higher", async () => {
  const f = await fixture(["L1", "L1", "L2"], true)
  assert.equal(await f.run(), "accepted")
  assert.deepEqual(f.calls.slice(3), [[0, 2, "middle", "L2"], [2, 2, "senior", "L3"]])
  assert.deepEqual(f.inputs, ["incorrect", "correct"])
  assert.deepEqual(f.audits, ["reviewer", "reviewer"])
  assert.equal(f.options.budget.requests, 7)
})

test("concurrent Workers, follow-up requests and Auditor share one hard limit", async () => {
  const f = await fixture(["L1", "L1"], false, 3)
  const worker = f.host.runWorker
  f.host.runWorker = async turn => {
    if (turn.index === 0) turn.reserve()
    return worker(turn)
  }
  await assert.rejects(f.run(), /Role request budget exhausted/)
  assert.equal(f.peak(), 2)
  assert.equal(f.options.budget.requests, 3)
  assert.deepEqual(f.audits, [])
})

test("cancellation during overlapping turns drains Workers before any dependent or audit", async () => {
  const f = await fixture(["L1", "L1", "L3"])
  const worker = f.host.runWorker
  f.host.runWorker = async turn => {
    const running = worker(turn)
    if (turn.index === 1) f.controller.abort()
    return running
  }
  assert.equal(await f.run(), "interrupted")
  assert.equal(f.options.states.at(-1), "cancelled")
  assert.deepEqual(f.calls.map(c => c[0]), [0, 1])
  assert.deepEqual(f.audits, [])
  assert.equal(f.files[0].source, null)
})

test("missing verifier, non-independent model and unmetered results fail closed", async () => {
  const f = await fixture(["L1"])
  f.host.verification = null
  assert.equal(await f.run(), "unsupported_verification")
  assert.deepEqual(f.calls, [])
  const g = await fixture(["L2"])
  g.options.models = { ...models, auditor: { ...models.l2 } }
  await assert.rejects(g.run(), /Non-independent assignment/)
  assert.deepEqual(g.calls, [])
  const h = await fixture(["L1"])
  h.host.runWorker = async () => "unmetered"
  await assert.rejects(h.run(), /Unmetered role result/)
  assert.deepEqual(h.audits, [])
  const k = await fixture(["L1"])
  k.host.inventory = k.host.inventory.map(m => ({ ...m, tools: false }))
  assert.equal(await k.run(), "unsupported_execution")
  assert.equal(k.options.budget.requests, 0)
})
