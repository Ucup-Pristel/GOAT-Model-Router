import assert from "node:assert/strict"
import test from "node:test"
import { decideTask, defaults } from "../../packages/core/src/index.ts"

// Black-box acceptance oracle from the independent round-3 report, not a
// snapshot of the current answers. A reproduced false-ready must exit nonzero.
const models = Object.fromEntries(["l1", "l2", "l3"].map(tier => [tier, { providerID: "fixture", modelID: tier }]))
const masks = {
  outcome: {},
  userPlan: { userPlan: ["Document the current parser behavior."] },
  resinkList: { mode: "resink", suffix: "\n- Document the current parser behavior." },
}
function decide(instruction, { mode = "standard", suffix = "", userPlan } = {}) {
  return decideTask({
    config: { ...defaults, enabled: true, models, mode }, availableModels: Object.values(models),
    instruction: instruction + suffix, userPlan,
    outcome: "The requested documentation update is complete.",
    acceptanceCriteria: ["The requested work is complete."],
  })
}

for (const [mask, options] of Object.entries(masks)) {
  for (const [finding, instructions] of Object.entries({
    B1: ["Delete the production database.", "Update production credentials.", "Change the authentication secret.",
      "Run the production migration.", "Rotate production credentials.", "Disable the production auth service.",
      "Drop the production database table."],
    B2: ["Add release v3 to production.", "Remove the release from production.", "Implement the v2 release.",
      "Fix the production deployment.", "Develop the v2 release.", "Add the release to the registry.",
      "Design the production deployment.", "Write the release to the registry."],
  })) {
    test(`Manager round 3 ${finding}: ${mask} cannot mask the original action`, async () => {
      const missed = []
      for (const instruction of instructions) {
        const result = await decide(instruction, options)
        if (result.readiness !== "needs_review" || !result.reviewReasons.length) missed.push(instruction)
      }
      assert.deepEqual(missed, [], "Original actions missing a review decision/reason")
    })
  }
  test(`Manager positive control: a benign ${mask} stays ready`, async () => {
    assert.equal((await decide("Write the release notes for the parser.", options)).readiness, "ready")
  })
}
