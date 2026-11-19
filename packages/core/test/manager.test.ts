import assert from "node:assert/strict"
import test from "node:test"
import {
  analyzeTask,
  compileWorkerPrompt,
  createIntent,
  decideTask,
  defaults,
  planResink,
  planStandard,
  routeTask,
  tierForAnalysis,
  tierForTask,
  validateOriginalIntent,
  validateTaskPlan,
  validateTaskSpecification,
  type GoatConfig,
  type TaskSpecification,
} from "../src/index.js"

const l1 = { providerID: "provider", modelID: "l1-model" }
const l2 = { providerID: "provider", modelID: "l2-model" }
const l3 = { providerID: "provider", modelID: "l3-model" }
const manager = { providerID: "provider", modelID: "manager-model" }

function config(overrides: Partial<GoatConfig> = {}): GoatConfig {
  return {
    ...defaults,
    enabled: true,
    inheritManagerModel: true,
    models: { l1, l2, l3 },
    ...overrides,
    ...(overrides.models ? { models: overrides.models } : {}),
  }
}

function task(overrides: Partial<TaskSpecification> = {}): TaskSpecification {
  const base: TaskSpecification = {
    id: "task-1",
    intentId: "intent-1",
    objective: "Complete the assigned work.",
    complexity: "simple",
    risk: "low",
    contextNeed: "minimal",
    executionConstraints: [],
    deliverables: ["Completed work"],
    acceptanceCriteria: ["Work matches the objective"],
    prohibitions: ["Do not exceed scope"],
    toolRestrictions: [],
    reportingFormat: "Report the result.",
    sourceRequirements: ["intent:intent-1"],
  }
  return validateTaskSpecification({ ...base, ...overrides })
}

test("simple tasks classify as L1 and use the configured L1 model", async () => {
  const result = await decideTask({
    instruction: "Reply with OK.",
    config: config(),
    availableModels: [l1],
  })
  assert.equal(result.status, "planned")
  assert.equal(result.decisions[0].tier, "L1")
  assert.deepEqual(result.decisions[0].model, l1)
  assert.equal(result.plan, null)
  assert.equal(Object.isFrozen(result.intent), true)
})

test("moderate implementation tasks classify as L2", async () => {
  const result = await decideTask({
    instruction: "Update the parser to handle empty input.",
    config: config(),
    availableModels: [l2],
  })
  assert.equal(result.decisions[0].tier, "L2")
  assert.deepEqual(result.decisions[0].model, l2)
})

test("complex and high-impact tasks classify as L3", async () => {
  const result = await decideTask({
    instruction: "Refactor the authentication flow across the repository, update tests, and audit security risks in production deployment.",
    config: config(),
    availableModels: [l3],
  })
  assert.equal(result.decisions[0].tier, "L3")
  assert.deepEqual(result.decisions[0].model, l3)
})

test("high-risk detection uses word boundaries and avoids substring false positives", () => {
  assert.notEqual(analyzeTask({ objective: "Update relationship documentation." }).risk, "high")
  assert.notEqual(analyzeTask({ objective: "Update push notification behavior." }).risk, "high")
  assert.notEqual(analyzeTask({ objective: "Ask the author for context." }).risk, "high")
  assert.equal(analyzeTask({ objective: "Deploy the service." }).risk, "high")
})

test("routing can select L3 directly through an explicit tier", () => {
  const analysis = analyzeTask({ objective: "Reply with OK." })
  const routed = routeTask(task({ tier: "L3" }), config(), [l3], analysis)
  assert.equal(routed.decision.tier, "L3")
  assert.ok(routed.decision.reasons.some((reason) => /Explicit tier L3/.test(reason)))
})

test("Standard preserves a user-supplied task plan without adding planner tasks", async () => {
  const result = await decideTask({
    instruction: "Implement the user's plan.",
    userPlan: ["Inspect the current implementation.", "Apply the requested change.", "Run the relevant checks."],
    config: config(),
    availableModels: [l1, l2, l3],
  })
  assert.equal(result.plan, null)
  assert.deepEqual(result.tasks.map((item) => item.objective), [
    "Inspect the current implementation.",
    "Apply the requested change.",
    "Run the relevant checks.",
  ])
  assert.equal(result.tasks.length, 3)
  assert.equal(result.decisions.length, 3)
})

test("Resink generates a structured plan with dependencies", async () => {
  const result = await decideTask({
    instruction: "1. Create the API.\n2. Add regression tests.\n3. Document the usage.",
    config: config({ mode: "resink" }),
    availableModels: [l1, l2, l3],
  })
  assert.equal(result.status, "planned")
  assert.ok(result.plan)
  assert.equal(result.plan.mode, "resink")
  assert.equal(result.plan.tasks.length, 3)
  assert.equal(result.plan.dependencies.length, 2)
  assert.equal(result.plan.dependencies[0].from, result.plan.tasks[0].id)
  assert.equal(result.plan.dependencies[0].to, result.plan.tasks[1].id)
  assert.match(result.prompts[1].text, /Upstream dependencies:/)
})

test("Resink does not split arbitrary prose or fenced code blocks into tasks", async () => {
  const instruction = "Update the parser. Do not modify production configuration.\n```js\nconst b = 2;\nreturn b;\n```"
  const result = await decideTask({
    instruction,
    prohibitions: ["Do not modify production configuration."],
    config: config({ mode: "resink" }),
    availableModels: [l1, l2, l3],
  })
  assert.ok(result.plan)
  assert.equal(result.plan.tasks.length, 1)
  assert.equal(result.plan.tasks[0].objective, instruction.trim())
})

test("Resink keeps non-list prose as context and preserves every explicit list item", async () => {
  const instruction = "Do not deploy.\n1. First task.\n2. Second task.\n3. Third task.\n4. Fourth task.\n5. Fifth task.\n6. Sixth task.\n7. Seventh task."
  const result = await decideTask({
    instruction,
    prohibitions: ["Do not deploy."],
    config: config({ mode: "resink" }),
    availableModels: [l1, l2, l3],
  })
  assert.ok(result.plan)
  assert.equal(result.plan.tasks.length, 7)
  assert.match(result.prompts[0].text, /Do not deploy\./)
  assert.match(result.prompts[0].text, /First task\./)
  assert.match(result.prompts[0].text, /Seventh task\./)
})

test("Resink respects an existing user plan instead of decomposing it", async () => {
  const userPlan = ["Inspect requirements.", "Implement only the approved change."]
  const result = await decideTask({
    instruction: "Follow the supplied plan.",
    userPlan,
    config: config({ mode: "resink" }),
    availableModels: [l1, l2, l3],
  })
  assert.deepEqual(result.tasks.map((item) => item.objective), userPlan)
  assert.ok(result.plan)
  assert.equal(result.plan.dependencies.length, 0)
})

test("original instruction and prohibitions are preserved in tasks and worker prompts", async () => {
  const instruction = "Update the parser. Do not modify production configuration."
  const result = await decideTask({
    instruction,
    prohibitions: ["Do not modify production configuration."],
    acceptanceCriteria: ["Parser tests pass."],
    config: config(),
    availableModels: [l1, l2, l3],
  })
  assert.equal(result.intent.instruction, instruction)
  assert.equal(result.tasks[0].prohibitions[0], "Do not modify production configuration.")
  assert.match(result.prompts[0].text, /Do not modify production configuration\./)
  assert.match(result.prompts[0].text, /Parser tests pass\./)
  assert.match(result.prompts[0].text, /Update the parser\./)
})

test("worker prompt generation covers every capability tier and required section", () => {
  const intent = createIntent({ instruction: "Do the work.", outcome: "Work is complete.", acceptanceCriteria: ["Work is complete."] })
  const baseTask = task({ intentId: intent.id, sourceRequirements: [`intent:${intent.id}`], prohibitions: ["Do not deploy."], acceptanceCriteria: ["Work is complete."] })
  for (const tier of ["L1", "L2", "L3"] as const) {
    const prompt = compileWorkerPrompt(baseTask, tier, intent)
    assert.equal(prompt.tier, tier)
    assert.match(prompt.text, new RegExp(`Capability tier: ${tier}`))
    assert.match(prompt.text, /Tier focus:/)
    for (const heading of ["Original task objective", "Relevant context", "Exact assigned scope", "Required deliverables", "Acceptance criteria", "Explicit prohibitions", "Tool and permission restrictions", "Expected reporting format"]) {
      assert.match(prompt.text, new RegExp(heading))
    }
    assert.match(prompt.text, /Do not deploy\./)
  }
})

test("the prompt compiler rejects a task that drops intent prohibitions or permissions", () => {
  const intent = createIntent({
    instruction: "Perform the work.",
    prohibitions: ["Do not deploy."],
    permissionBoundaries: ["No network access."],
    acceptanceCriteria: ["Work is complete."],
  })
  const unsafeTask = task({
    intentId: intent.id,
    sourceRequirements: [`intent:${intent.id}`],
    prohibitions: [],
    toolRestrictions: [],
    acceptanceCriteria: ["Work is complete."],
  })
  assert.throws(() => compileWorkerPrompt(unsafeTask, "L1", intent), /dropped an explicit prohibition/)
})

test("the prompt compiler rejects permission-only loss, out-of-scope objectives, and tier mismatch", () => {
  const permissionIntent = createIntent({ instruction: "Perform the work.", permissionBoundaries: ["No network access."] })
  const missingPermission = task({ intentId: permissionIntent.id, sourceRequirements: [`intent:${permissionIntent.id}`], toolRestrictions: [] })
  assert.throws(() => compileWorkerPrompt(missingPermission, "L1", permissionIntent), /permission boundary/)

  const scopeIntent = createIntent({ instruction: "Perform the work." })
  const outOfScope = task({ intentId: scopeIntent.id, sourceRequirements: [`intent:${scopeIntent.id}`], objective: "Run deploy." })
  assert.throws(() => compileWorkerPrompt(outOfScope, "L1", scopeIntent), /Out-of-scope objective/)

  const tierIntent = createIntent({ instruction: "Perform the work.", acceptanceCriteria: ["Work is complete."] })
  const tierTask = task({ intentId: tierIntent.id, sourceRequirements: [`intent:${tierIntent.id}`], tier: "L3", acceptanceCriteria: ["Work is complete."] })
  assert.throws(() => compileWorkerPrompt(tierTask, "L1", tierIntent), /does not match task tier/)
})

test("ambiguous requirements are reported instead of invented", async () => {
  const result = await decideTask({
    instruction: "Improve it.",
    config: config(),
    availableModels: [l1],
  })
  assert.ok(result.intent.ambiguities.length > 0)
  assert.match(result.prompts[0].text, /Known ambiguities:/)
})

test("missing and unavailable models produce explicit errors", async () => {
  await assert.rejects(
    decideTask({ instruction: "Do the work.", config: config({ models: {} }), availableModels: [l1] }),
    /Missing model assignment for L1/,
  )
  await assert.rejects(
    decideTask({ instruction: "Do the work.", config: config(), availableModels: [l2] }),
    /Unavailable model for L1/,
  )
  await assert.rejects(
    decideTask({ instruction: "Do the work.", config: config(), availableModels: [] }),
    /Unavailable model for L1/,
  )
  await assert.rejects(
    decideTask({
          instruction: "Do the work.",
      config: config({ inheritManagerModel: false, models: { l1 } }),
      availableModels: [l1],
    }),
    /Missing model assignment for Manager/,
  )
})

test("invalid configuration and availability inputs are rejected", async () => {
  await assert.rejects(
    decideTask({ instruction: "Do work.", config: {} as GoatConfig }),
    /Invalid GOAT configuration/,
  )
  await assert.rejects(
    decideTask({ instruction: "Do work.", config: config(), availableModels: "bad" as never }),
    /Invalid availableModels/,
  )
})

test("a manager reasoner cannot erase capability uncertainty or omit rationale", async () => {
  const reasoner = {
    analyzeTask: () => ({ complexity: "simple" as const, risk: "low" as const, contextNeed: "minimal" as const, reasons: [], uncertainty: [] }),
  }
  const result = await decideTask({
    instruction: "Reply with OK.",
    config: config(),
    availableModels: [l1],
    reasoner,
  })
  assert.ok(result.decisions[0].uncertainty.some((item) => /Model capability metadata/.test(item)))
  assert.ok(result.decisions[0].uncertainty.some((item) => /Manager reasoner supplied/.test(item)))
  assert.ok(result.decisions[0].reasons.some((item) => /no rationale/.test(item)))
})

test("plan-level acceptance criteria propagate to tasks, prompts, and verification", async () => {
  const result = await decideTask({
    instruction: "Do the work.",
    config: config({ mode: "resink" }),
    availableModels: [l1, l2, l3],
  })
  assert.ok(result.plan)
  const criterion = result.plan.acceptanceCriteria[0]
  assert.ok(criterion)
  assert.ok(result.tasks[0].acceptanceCriteria.includes(criterion))
  assert.ok(result.verification[0].criteria.includes(criterion))
  assert.match(result.prompts[0].text, new RegExp(criterion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
})

test("out-of-scope deploy, publish, release, and push objectives are rejected", async () => {
  for (const instruction of [
    "Deploy the service to production.",
    "Run deploy.",
    "Run npm publish.",
    "Deploying the service.",
    "Publishing the package.",
    "Release to production.",
    "ship to production",
    "npm publish",
    "Update parser. Then run npm publish.",
    "First update docs. Finally deploy to production.",
    "Do not deploy. Run deploy script.",
    "Push to main.",
    "Push",
    "Release",
    "Ship",
    "Deployment of the service.",
    "Run deployment.",
    "Execute deployment.",
    "Perform deployment.",
    "No blockers, run deploy.",
    "Do not deploy, run deploy script.",
    "Without delay, deploy.",
    "Avoid delay, deploy.",
    "Never mind, deploy.",
    "Push production",
    "Push origin main",
    "Push main",
    "Push my changes",
    "Push a commit",
    "Push commits",
    "Push a branch",
    "Push the main branch",
    "Push the production branch",
    "Push my code",
    "Push new changes",
    "Push remote",
    "Push origin",
    "Push it",
    "Push now",
    "Pushing",
    "Release the package",
    "Release the build",
    "Release the service",
    "Release the app",
    "Release the version",
    "Release the artifact",
    "Release the production build",
    "Release it",
    "Releasing",
    "Ship the package",
    "Ship the build",
    "Ship the service",
    "Ship the app",
    "Ship the release",
    "Ship the artifact",
    "Ship the version",
    "Ship the production build",
    "Ship it",
    "Ship now",
    "Ship today",
    "Ship immediately",
    "Shipping",
    "Deploying",
    "Publishing",
    "Pushing",
    "Do not deploy and run deploy script.",
    "Do not deploy then run deploy script.",
    "No blockers and run deploy.",
    "Without delay and deploy.",
    "Avoid delay and deploy.",
    "Never mind and deploy.",
    "Cannot deploy and run deploy.",
    "Under no circumstances deploy and run deploy.",
    "Prohibited: deploy and run deploy.",
    "Forbidden to deploy and run deploy.",
    "Not deploy and run deploy.",
    "Refrain from deploying and run deploy.",
    "Deployment guide and deploy the service.",
    "Deployment guide then deploy the service.",
    "Publish docs and run npm publish.",
    "Update publish docs and run npm publish.",
    "Release notes and push production.",
    "Push the boundary and push production.",
    "Ship the feature and release the package.",
    "Update deploy script and deploy the service.",
    "Deployment guide and release the package.",
    "Deployment guide and ship now.",
    "Push the boundary and push origin main.",
    "Release feature and push main.",
    "Ship feature and push commits.",
    "Push upstream",
    "Pushing upstream",
    "Push into main",
    "Push onto production",
    "Push to the remote",
    "Push to a remote",
    "Push a PR",
    "Push PR",
    "Push tag",
    "Push tags",
    "Push a tag",
    "Push feature",
    "Push the feature",
    "Push the feature branch",
    "Push new feature",
    "Push my feature",
    "Push hotfix",
    "Push the hotfix",
    "Push changeset",
    "Push version",
    "Push fork",
    "Push to fork",
    "Push upstream main",
    "Push feature branch",
    "Push hotfix branch",
    "Push my feature branch",
    "Do not deploy but run deploy script.",
    "Do not deploy however run deploy script.",
    "Do not deploy yet run deploy script.",
    "Do not deploy or run deploy script.",
    "Do not deploy / run deploy script.",
    "Do not deploy + run deploy script.",
    "No blockers but run deploy.",
    "Without delay but deploy.",
    "Deployment guide but deploy the service.",
    "Publish docs but run npm publish.",
    "Release notes but push production.",
    "Push the boundary but push production.",
    "Ship the feature but release the package.",
    "Update deploy script but deploy the service.",
    "Deployment guide however deploy the service.",
    "Deployment guide or deploy the service.",
    "Deployment guide / deploy the service.",
    "Deployment guide + deploy the service.",
    "Without network access and deploy.",
    "Without network access and publish.",
    "Without network access and push.",
    "Do not touch config and deploy.",
    "Do not touch config and publish.",
    "No tests and deploy.",
    "No tests and publish.",
    "No changes and deploy.",
    "Avoid risk and deploy.",
    "Push a new tag",
    "Push the new branch",
    "Push my new branch",
    "Push our new branch",
    "Push their changes",
    "Push team changes",
    "Push the latest commit",
    "Push a new commit",
    "Push the latest changes",
    "Push a new feature branch",
    "Push a new hotfix",
    "Push the new hotfix",
    "Push the new main branch",
    "Push a new version",
    "Push the latest version",
    "Push a new PR",
    "Push our new changes",
    "Push my new changes",
    "Push the new changes",
    "Push a new release",
    "Push the new release",
    "Push the new package",
    "Push a new build",
    "Push the latest build",
    "Deploy the feature",
    "Deploy the new feature",
    "Deploy feature",
    "Deploy features",
    "Deploy the bug fix",
    "Deploy the issue",
    "Deploy the failure",
    "Deploy the feature branch",
    "Deploy the bug fix branch",
    "Publish the feature",
    "Publish the bug fix",
    "Publish the issue",
    "Publish the failure",
    "Publish the bug fix package",
    "Release the bug fix",
    "Release the issue",
    "Release the failure",
    "Release the bug fix build",
    "Ship the bug fix",
    "Ship the issue",
    "Ship the failure",
    "Review: deploy the service",
    "Plan: deploy the service",
    "Document: deploy the service",
    "Update: deploy the service",
    "Fix: deploy the service",
    "Test: deploy the service",
    "Check: deploy the service",
    "Implement: deploy the service",
    "Review deployment: deploy the service",
    "Plan deployment: deploy the service",
    "Plan deployment - deploy the service",
    "Plan deployment — deploy the service",
    "Plan deployment | deploy the service",
    "Plan deployment -> deploy the service",
    "Review deployment+deploy the service",
    "Deployment guide+deploy the service",
    "Deployment guide/deploy the service",
    "Deployment guide&deploy the service",
    "Deployment guide: deploy the service",
    "Deployment guide - deploy the service",
    "Deployment guide — deploy the service",
    "Deployment guide | deploy the service",
    "Deployment guide -> deploy the service",
    "Update deploy script+deploy the service",
    "Update deploy script: deploy the service",
    "Update deploy script - deploy the service",
    "Publish docs+run npm publish",
    "Release notes&push production",
    "Push boundary+push production",
    "Deployment guide+deploy src/config",
    "Deployment guide&push origin/main",
    "Deployment guide/push origin/main",
    "Release notes&push origin/main",
    "Push boundary+push origin/main",
    "Update deploy script+deploy src/config",
    "Review deployment+deploy src/config",
    "Plan deployment+push origin/main",
  ]) {
    await assert.rejects(
      decideTask({ instruction, config: config(), availableModels: [l1, l2, l3] }),
      /Out-of-scope objective/,
    )
  }
  for (const instruction of [
    "Push the boundary.",
    "Push notification.",
    "Ship the feature.",
    "Release the feature.",
    "Release notes.",
    "Update deploy script.",
    "Deployment guide",
    "Deployment plan",
    "Deployment docs",
    "Deployment documentation",
    "Deploy docs",
    "Deploy documentation",
    "Deployment strategy",
    "Deployment checklist",
    "Deployment architecture",
    "Deployment design",
    "Deployment troubleshooting",
    "Publish docs",
    "Update publish docs",
    "Deploying docs",
    "Deploying guide",
    "Deploying plan",
    "Deploying documentation",
    "Deploying strategy",
    "Deploying architecture",
    "Deploying design",
    "Deploying troubleshooting",
    "Deploying notes",
    "Release the notes",
    "Ship the notes",
    "Release features",
    "Ship features",
    "Release the features",
    "Ship the features",
    "Release the docs",
    "Ship the docs",
    "Publishing the docs",
    "Publish the docs",
    "Publish the documentation",
    "Update publish the docs",
    "Release documentation",
    "Ship documentation",
    "Release the documentation",
    "Ship the documentation",
    "Deploy documentation",
    "Deploying documentation",
    "Deploy our docs",
    "Deploying our docs",
    "Deploying the new docs",
    "Deploy the new docs",
    "Release our docs",
    "Release the new docs",
    "Release the latest docs",
    "Ship our docs",
    "Ship the new docs",
    "Publish our docs",
    "Publish new docs",
    "Publish the new docs",
    "Publishing our docs",
    "Publishing the new docs",
    "Release our features",
    "Release the new features",
    "Ship our features",
    "Ship the new features",
    "Release the latest notes",
    "Ship the latest notes",
    "Review deployment",
    "Plan deployment",
    "Document deployment",
    "Test deployment",
    "Read deployment guide",
    "Check deployment status",
    "Open deployment guide",
    "Summarize deployment docs",
    "Review deploy",
    "Test deploy script",
    "Document deploy script",
    "Plan deploy script",
    "Update deployment process",
    "Update deployment pipeline",
    "Update deployment policy",
    "Update deployment schedule",
    "Update deployment timeline",
    "Fix release package",
    "Fix publish package",
    "Fix ship package",
    "Fix push service",
    "Update push API",
    "Fix push API",
    "Push feature flags",
    "Push the feature flags",
    "Push API",
    "Push UI",
    "Push updates",
    "Push service",
    "Read release notes",
    "Translate release notes",
    "Review release notes",
    "Fix push notification",
    "Update src/deploy/config.ts",
    "Update docs/release/notes.md",
    "Update publish/docs",
    "Update apps/deploy/README.md",
    "Fix packages/core/src/deploy.ts",
    "Update src/publish/index.ts",
    "Update src/release/notes.md",
    "Update src/ship/config.ts",
    "Update R&D deploy docs",
    "Update C++ deploy docs",
    "Refactor auth across production deployment.",
    "Please review deployment",
    "Please update deployment docs",
    "Please fix release package",
    "Please test deploy script",
    "The deployment is broken",
    "Deployment is broken",
    "Release is broken",
    "Publish is failing",
    "Ship is failing",
    "Push is broken",
    "The deployment guide needs update",
    "The release notes are outdated",
    "Can you review deployment",
    "We should review deployment",
    "I need to update deployment docs",
    "Let's review deployment",
    "Let us review deployment",
    "Please help review deployment",
    "Could you kindly review deployment",
    "Please make sure deployment docs are updated",
    "The deployment has errors",
    "The deployment has bugs",
    "The deployment is down",
    "The deploy script is broken",
    "Deploy is broken",
    "The push service is down",
    "The release notes need updating",
    "production deployment",
  ]) {
    const result = await decideTask({ instruction, config: config(), availableModels: [l1, l2, l3] })
    assert.equal(result.status, "planned")
  }
})

test("explicit-list prohibitions are not promoted to tasks", async () => {
  await assert.rejects(
    decideTask({
      instruction: "- Do not modify production configuration.\n- Do not touch secrets.",
      config: config({ mode: "resink" }),
      availableModels: [l1, l2, l3],
    }),
    /No actionable task found/,
  )
  for (const instruction of [
    "Constraints:\n- Do not deploy.\n- Do not modify production configuration.",
    "Notes:\n- Do not deploy.",
    "Do not deploy.\n- Do not modify production configuration.",
    "No tests needed.\n- Do not deploy.",
    "- Cannot deploy.\n- Don’t deploy.\n- Under no circumstances deploy.",
    "Constraints\n- Do not deploy.",
    "### Constraints\n- Do not deploy.",
    "---\n- Do not deploy.",
    "N/A\n- Do not deploy.",
    "None\n- Do not deploy.",
    "Deliverables\n- Do not deploy.",
    "Goals\n- Do not deploy.",
    "Approach\n- Do not deploy.",
    "Implementation\n- Do not deploy.",
    "Plan\n- Do not deploy.",
    "Design\n- Do not deploy.",
    "Architecture\n- Do not deploy.",
    "Risks\n- Do not deploy.",
    "Dependencies\n- Do not deploy.",
    "Deliverables:\n- Do not deploy.",
    "## Deliverables\n- Do not deploy.",
    "Constraints: Do not deploy\n- Do not modify production configuration.",
    "Notes: Do not deploy\n- Do not modify production configuration.",
    "Challenges\n- Do not deploy.",
    "Open questions\n- Do not deploy.",
    "Success criteria\n- Do not deploy.",
    "Assumptions\n- Do not deploy.",
    "Non-goals\n- Do not deploy.",
    "Out of scope\n- Do not deploy.",
    "Implementation details\n- Do not deploy.",
    "Notes and constraints\n- Do not deploy.",
    "Next steps\n- Do not deploy.",
    "### Challenges\n- Do not deploy.",
    "## Success criteria\n- Do not deploy.",
    "Risks and mitigations\n- Do not deploy.",
    "Open issues\n- Do not deploy.",
    "Action items\n- Do not deploy.",
    "Follow-ups\n- Do not deploy.",
    "Decisions\n- Do not deploy.",
    "Testing strategy\n- Do not deploy.",
    "Test plan\n- Do not deploy.",
    "Validation\n- Do not deploy.",
    "Rollout\n- Do not deploy.",
    "Migration plan\n- Do not deploy.",
    "Known issues\n- Do not deploy.",
    "Open risks\n- Do not deploy.",
    "Next actions\n- Do not deploy.",
    "Action plan\n- Do not deploy.",
    "Success metrics\n- Do not deploy.",
    "Key risks\n- Do not deploy.",
    "Questions\n- Do not deploy.",
    "Mitigations\n- Do not deploy.",
    "Risks/mitigations\n- Do not deploy.",
    "Assumptions and risks\n- Do not deploy.",
    "Notes and risks\n- Do not deploy.",
    "Open questions and risks\n- Do not deploy.",
    "Review notes\n- Do not deploy.",
    "Testing notes\n- Do not deploy.",
    "Known problems\n- Do not deploy.",
    "Open problems\n- Do not deploy.",
    "Key questions\n- Do not deploy.",
    "Unknowns\n- Do not deploy.",
    "Constraints and assumptions\n- Do not deploy.",
    "Risks and assumptions\n- Do not deploy.",
    "Notes and assumptions\n- Do not deploy.",
    "Questions and answers\n- Do not deploy.",
    "Action items and owners\n- Do not deploy.",
    "Follow-up items\n- Do not deploy.",
    "Decisions and open questions\n- Do not deploy.",
    "Test results\n- Do not deploy.",
    "Testing summary\n- Do not deploy.",
    "Validation results\n- Do not deploy.",
    "Rollout plan\n- Do not deploy.",
    "Migration steps\n- Do not deploy.",
  ]) {
    await assert.rejects(
      decideTask({ instruction, config: config({ mode: "resink" }), availableModels: [l1, l2, l3] }),
      /No actionable task found/,
    )
  }

  const mixed = await decideTask({
    instruction: "- Do not deploy.\n- Update the parser.",
    config: config({ mode: "resink" }),
    availableModels: [l1, l2, l3],
  })
  assert.ok(mixed.plan)
  assert.equal(mixed.plan.tasks.length, 1)
  assert.equal(mixed.plan.tasks[0].objective, "Update the parser.")
  assert.match(mixed.prompts[0].text, /Do not deploy\./)

  const proseWithProhibitionList = await decideTask({
    instruction: "Update the parser.\n- Do not deploy.",
    config: config({ mode: "resink" }),
    availableModels: [l1, l2, l3],
  })
  assert.ok(proseWithProhibitionList.plan)
  assert.equal(proseWithProhibitionList.plan.tasks.length, 1)
  assert.equal(proseWithProhibitionList.plan.tasks[0].objective, "Update the parser.")

  for (const item of [
    "- Without network access, update the parser.",
    "- Avoid delay, update the parser.",
    "- No blockers, update the parser.",
    "- Do not touch config, update the parser.",
    "- Do not deploy: update the parser.",
    "- Do not deploy; update the parser.",
    "- Do not deploy. update the parser.",
    "- Without network access: update the parser.",
    "- Without network access; update the parser.",
    "- Without network access. update the parser.",
    "- No network access: update the parser.",
    "- Do not deploy, but update the parser.",
    "- Prohibited: deploy, update the parser.",
    "- Prohibited: deploy; update the parser.",
    "- Prohibited: deploy: update the parser.",
    "- Prohibited: deploy. update the parser.",
    "- Forbidden: deploy. update the parser.",
    "- No: deploy. update the parser.",
    "- Never: deploy. update the parser.",
    "- Avoid: deploy. update the parser.",
    "- Without: deploy. update the parser.",
    "- Not: deploy. update the parser.",
  ]) {
    const result = await decideTask({ instruction: item, config: config({ mode: "resink" }), availableModels: [l1, l2, l3] })
    assert.ok(result.plan)
    assert.equal(result.plan.tasks.length, 1)
    assert.equal(result.plan.tasks[0].objective.replace(/\.$/, ""), "update the parser")
  }

  for (const item of [
    "Constraints: Do not deploy, update parser\n- Do not modify production configuration.",
    "Notes: Do not deploy; update parser\n- Do not modify production configuration.",
    "- Do not deploy and update parser.",
    "- Without network access and update parser.",
    "- No blockers and update parser.",
    "- Prohibited: deploy and update parser.",
    "Constraints: Do not deploy but update parser\n- Do not modify production configuration.",
    "Notes: Do not deploy however update parser\n- Do not modify production configuration.",
    "Constraints: Do not deploy or update parser\n- Do not modify production configuration.",
    "- Do not deploy or update parser.",
    "- Do not deploy however update parser.",
    "- Do not deploy yet update parser.",
    "- Without network access or update parser.",
    "- No blockers or update parser.",
    "- Prohibited: deploy or update parser.",
    "- Prohibited: deploy however update parser.",
    "- Do not deploy+update parser.",
    "- Without network access&update parser.",
    "- Prohibited: deploy+update parser.",
  ]) {
    const result = await decideTask({ instruction: item, config: config({ mode: "resink" }), availableModels: [l1, l2, l3] })
    assert.ok(result.plan)
    assert.equal(result.plan.tasks.length, 1)
    assert.equal(result.plan.tasks[0].objective.replace(/\.$/, ""), "update parser")
  }

  for (const item of [
    "Do not deploy. Update parser.\n- Do not modify production configuration.",
    "No tests needed. Update parser.\n- Do not modify production configuration.",
    "Cannot deploy. Update parser.\n- Do not modify production configuration.",
  ]) {
    const result = await decideTask({ instruction: item, config: config({ mode: "resink" }), availableModels: [l1, l2, l3] })
    assert.ok(result.plan)
    assert.equal(result.plan.tasks.length, 1)
    assert.equal(result.plan.tasks[0].objective, "Update parser.")
  }

  const notOnly = await decideTask({
    instruction: "- Not only update the parser, but also add tests.",
    config: config({ mode: "resink" }),
    availableModels: [l1, l2, l3],
  })
  assert.ok(notOnly.plan)
  assert.equal(notOnly.plan.tasks.length, 1)
  assert.match(notOnly.plan.tasks[0].objective, /^Not only update the parser, but also add tests\.$/)

  const expanded = await decideTask({
    instruction: "- Cannot deploy.\n- Don’t deploy.\n- Under no circumstances deploy.\n- Prohibited: deploy.\n- Forbidden to deploy.\n- Not deploy.\n- Refrain from deploying.\n- Update the parser.",
    config: config({ mode: "resink" }),
    availableModels: [l1, l2, l3],
  })
  assert.ok(expanded.plan)
  assert.equal(expanded.plan.tasks.length, 1)
  assert.equal(expanded.plan.tasks[0].objective, "Update the parser.")
})

test("plus Markdown bullets are recognized as explicit list items", async () => {
  const result = await decideTask({
    instruction: "+ First task.\n+ Second task.",
    config: config({ mode: "resink" }),
    availableModels: [l1, l2, l3],
  })
  assert.ok(result.plan)
  assert.deepEqual(result.plan.tasks.map((item) => item.objective), ["First task.", "Second task."])
})

test("explicit tiers are honored by routing helpers and reject invalid values", async () => {
  const explicitTask = task({ tier: "L3" })
  assert.equal(tierForTask(explicitTask), "L3")
  const analysis = analyzeTask({ objective: "Reply with OK." })
  assert.equal(tierForAnalysis({ ...analysis, tier: "L3" }), "L3")
  assert.throws(() => routeTask({ ...task({ tier: "L3" }), tier: "L4" as never }, config(), [l3]), /Invalid capability tier/)
  assert.throws(() => routeTask(task({ tier: "L3" }), config(), [l3], { ...analysis, tier: "L4" as never }), /Invalid capability tier/)
  const result = await decideTask({
    instruction: "Reply with OK.",
    config: config(),
    availableModels: [l3],
    tier: "L3",
  })
  assert.equal(result.decisions[0].tier, "L3")
  await assert.rejects(
    decideTask({ instruction: "Reply with OK.", config: config(), availableModels: [l3], tier: "L4" as never }),
    /capability tier/,
  )
})

test("unknown core decision-request fields are rejected", async () => {
  await assert.rejects(
    decideTask({ instruction: "Do the work.", config: config(), unexpected: true } as never),
    /unknown field unexpected/,
  )
})

test("blank user-plan entries and invalid explicit tiers are rejected", () => {
  assert.throws(() => createIntent({ instruction: "Do work.", userPlan: ["Do A.", "   "] }), /blank task entries/)
  assert.throws(() => validateTaskSpecification({ ...task(), tier: "L4" }), /Invalid TaskSpecification.tier/)
})

test("intent is runtime-frozen and its ID covers constraints and prohibitions", () => {
  const first = createIntent({ instruction: "Do the work.", constraints: ["One constraint."] })
  const second = createIntent({ instruction: "Do the work.", constraints: ["A different constraint."] })
  const third = createIntent({ instruction: "Do the work.", constraints: [" One constraint. "] })
  const emptyOutcome = createIntent({ instruction: "Do work.", outcome: "" })
  const omittedOutcome = createIntent({ instruction: "Do work." })
  assert.notEqual(first.id, second.id)
  assert.equal(first.id, third.id)
  assert.equal(emptyOutcome.id, omittedOutcome.id)
  assert.equal(Object.isFrozen(first), true)
  assert.equal(Object.isFrozen(first.constraints), true)
})

test("GOAT OFF bypasses the decision pipeline without tasks, prompts, or reasoner calls", async () => {
  let called = 0
  const result = await decideTask({
    instruction: "Do the work.",
    config: config({ enabled: false, models: {} }),
    reasoner: {
      analyzeTask: () => {
        called++
        return { complexity: "complex", risk: "high", contextNeed: "extensive", reasons: [], uncertainty: [] }
      },
    },
  })
  assert.equal(result.status, "bypassed")
  assert.match(result.reason ?? "", /GOAT is OFF/)
  assert.equal(result.tasks.length, 0)
  assert.equal(result.decisions.length, 0)
  assert.equal(result.prompts.length, 0)
  assert.equal(result.verification.length, 0)
  assert.equal(called, 0)
})

test("invalid task, plan, and intent contracts are rejected", () => {
  assert.throws(() => validateTaskSpecification({ id: "x" }), /Invalid TaskSpecification/)
  assert.throws(() => validateOriginalIntent({ id: "i", instruction: "" }), /Invalid OriginalIntent/)
  assert.throws(() => validateTaskSpecification({ ...task(), complexity: "extreme" }), /Invalid TaskSpecification.complexity/)
  assert.throws(() => validateTaskSpecification({ ...task(), sourceRequirements: [] }), /sourceRequirements/)
  const intent = createIntent({ instruction: "Do the work.", acceptanceCriteria: ["Work is done."] })
  const validPlan = planResink(intent)
  assert.throws(() => validateTaskPlan({ ...validPlan, dependencies: [{ from: "missing", to: validPlan.tasks[0].id, reason: "bad" }] }), /unknown task id/)
  assert.throws(() => validateTaskPlan({ ...validPlan, dependencies: [{ from: validPlan.tasks[0].id, to: validPlan.tasks[0].id, reason: "cycle" }] }), /cycle detected/)
  assert.throws(() => createIntent({ instruction: "Do work.", outcome: 3 as never }), /outcome must be a string/)
})

test("a future manager reasoner can propose analysis without model calls", async () => {
  const reasoner = {
    analyzeTask: () => ({ complexity: "simple" as const, risk: "low" as const, contextNeed: "minimal" as const, tier: "L3" as const, reasons: ["Reasoner selected complex work."], uncertainty: ["Capability metadata unavailable."] }),
  }
  const result = await decideTask({
    instruction: "Do the work.",
    config: config({ mode: "resink" }),
    availableModels: [l1, l2, l3],
    reasoner,
  })
  assert.equal(result.status, "planned")
  assert.ok(result.plan)
  assert.equal(result.decisions[0].tier, "L3")
  assert.equal(result.decisions[0].decisionSource, "manager_reasoner")
  assert.ok(result.decisions[0].reasons.some((reason) => /Reasoner selected/.test(reason)))
  assert.ok(result.decisions[0].reasons.some((reason) => /Explicit tier L3/.test(reason)))
})
