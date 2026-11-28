import assert from "node:assert/strict"
import test from "node:test"
import { decideTask, defaults, digest, executePlan, RoleBudget, type ExecutionHost, type ExecutionOptions } from "../src/index.js"

test("analytical audit checks OriginalIntent and bounded rework without passing a write gate",async () => {
  const ref = (modelID:string) => ({providerID:"fixture",modelID})
  const models = {l1:ref("worker"),l2:ref("middle"),l3:ref("senior"),auditor:ref("reviewer")}
  const instruction = "Inspect the authorized repository and cite evidence for the backend architecture."
  const plan = await decideTask({instruction,acceptanceCriteria:["Explain the backend using input citations."],config:{...defaults,enabled:true,models}})
  const project = {files:[{path:"server.js",role:"read" as "read"|"edit"}],schedule:{tasks:[{objective:instruction,
    read:["server.js"],write:[],dependsOn:[],suites:[],criteria:["Explain the backend using input citations."]}]}}
  const options:ExecutionOptions = {states:["queued","classifying"],models,budget:new RoleBudget(8),rework:true,verification:{kind:"analysis",project}}
  let workers = 0, audits = 0
  const host:ExecutionHost = {
    inventory:Object.values(models).map(m => ({...m,tools:true})),signal:new AbortController().signal,interruptWorkers:()=>{},
    verification:{suiteResource:s=>s,inspect:async()=>({passed:true,sha256:digest("original inputs"),results:[]})},
    runWorker:async ({reserve,attempt,text}) => {reserve();workers++;if (attempt === 2) assert.match(text,/Missing citation/);return attempt === 1 ? "Express backend" : "server.js:1 imports Express"},
    audit:async ({reserve,text,model}) => {
      reserve();audits++
      assert.deepEqual(model,models.auditor)
      const p = JSON.parse(text.split("\n").at(-1)!)
      assert.equal(p.instruction,instruction)
      return JSON.stringify({taskId:p.taskId,attempt:p.attempt,criterion:p.criteria[0],reportSha256:p.reportSha256,sha256:p.evidence.sha256,
        outcome:audits === 1 ? "FAIL" : "PASS",riskReview:"Read original inputs and checked citations.",
        findings:audits === 1 ? [{kind:"scoped-defect",taskId:"task-1",suite:"",detail:"Missing citation"}] : []})
    },
  }
  assert.equal(await executePlan(plan,options,host),"analysis_accepted")
  assert.equal(workers,2)
  assert.equal(audits,2)
  assert.equal(options.budget.requests,4)
  project.files[0].role = "edit"
  await assert.rejects(executePlan(plan,{...options,states:["queued","classifying"]},host),/Analysis cannot authorize writes/)
})
