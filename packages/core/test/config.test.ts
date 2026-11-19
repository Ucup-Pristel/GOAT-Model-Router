import assert from "node:assert/strict"
import test from "node:test"
import { defaults, modelStatus, validateConfig } from "../src/index.js"

test("configuration defaults OFF and malformed input resets safely", () => {
  assert.equal(defaults.enabled, false)
  assert.deepEqual(validateConfig({ version: 99, enabled: true }), defaults)
  assert.equal(validateConfig({ ...defaults, enabled: true }).enabled, true)
  assert.deepEqual(validateConfig({ version: 1, enabled: true, mode: "standard" }), defaults)
  assert.equal(modelStatus({ providerID: "p", modelID: "m" }, [{ providerID: "p", modelID: "m" }]), "p/m")
  assert.equal(modelStatus({ providerID: "p", modelID: "gone" }, []), "p/gone (unavailable)")
  assert.deepEqual(validateConfig({ version: 1, enabled: false, mode: "standard", inheritManagerModel: true, models: { l1: { providerID: "", modelID: "bad" } } }), defaults)
  const saved = validateConfig({ ...defaults, enabled: true, mode: "resink" })
  assert.deepEqual(validateConfig(saved), saved)
})
