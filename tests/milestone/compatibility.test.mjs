import assert from "node:assert/strict"
import test from "node:test"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync } from "node:fs"
import { defaults } from "@goatmr/core"
import { startHost } from "./host-fixture.mjs"

// Synthetic reconstruction authorized by the Owner, not the missing verbatim prompt.
const instruction = "Investigate the Edulib Node.js/Express/React/PostgreSQL backend repository using rust-anything MCP. Analyze migration risks for a Rust backend. Do not deploy. Do not access production databases. Return findings with repository evidence."

test("Edulib synthetic baseline: readiness fails before a Worker or verifier runs", {timeout:30000,skip:process.env.GOAT_REPRO_BASELINE !== "1"}, async t => {
  let discoveries = 0
  const h = await startHost(t, call => {
    assert.equal(call.model,"mock","baseline must not dispatch a role")
    if (!call.tools.includes("goat_verify_text")) return "See receipt."
    if (discoveries++ < 6) return {tool:"read",args:{path:["AGENTS.md","backend/AGENTS.md","frontend/AGENTS.md"][discoveries % 3]}}
    return {tool:"goat_verify_text",args:{tasks:[{read:["AGENTS.md","backend/AGENTS.md","frontend/AGENTS.md"],write:["discovery.md"]}],tests:[]}}
  },"workspace")
  const root = dirname(h.file)
  for (const path of ["AGENTS.md","backend/AGENTS.md","frontend/AGENTS.md"]) {
    await mkdir(dirname(join(root,path)),{recursive:true})
    await writeFile(join(root,path),"Synthetic repository guidance. Inspect only authorized inputs.\n")
  }
  const rpc = async (method,input) => (await h.api(`rpc/goat.model-router/${method}`,"POST",{input})).output
  const ref = modelID => ({providerID:"fixture",modelID})
  await rpc("setConfig",{config:{...defaults,enabled:true,models:{l1:ref("middle"),l2:ref("middle"),l3:ref("senior"),auditor:ref("auditor")}}})
  const actions = ["read","goat_discover","goat_verify_text","goat_workspace","edit","write"]
  const id = await h.session([{action:"*",resource:"*",effect:"deny"},...actions.map(action => ({action,resource:"*",effect:"allow"}))],{agent:"build"})
  await h.prompt(id,instruction)
  await h.wait(id)
  const part = (await h.api(`session/${id}/context`)).flatMap(m => m.content ?? []).findLast(p => p.name === "goat_verify_text")
  assert.equal(part?.state.status,"completed",JSON.stringify(part))
  const receipt = JSON.parse(part.state.content[0].text)
  assert.equal(receipt.reason,"needs_review")
  assert.equal(receipt.verification,"unsupported")
  assert.equal(receipt.checksPassed,false)
  assert.equal(receipt.application.status,"not_applied")
  const trace = (await readFile(receipt.trace.path,"utf8")).trim().split("\n").map(JSON.parse)
  assert.equal(trace.length,1)
  assert.equal(trace[0].requests,0)
  assert.equal(trace[0].turns,0)
  assert.ok(h.calls.every(c => c.model === "mock"))
  t.diagnostic(JSON.stringify({receipt,trace}))
})

const ref = modelID => ({providerID:"fixture",modelID})
async function enable(h) {
  const rpc = async (method,input) => (await h.api(`rpc/goat.model-router/${method}`,"POST",{input})).output
  await rpc("setConfig",{config:{...defaults,enabled:true,models:{l1:ref("middle"),l2:ref("middle"),l3:ref("senior"),auditor:ref("auditor")}}})
  return rpc
}
const permissions = ["read","glob","goat_discover","goat_verify_text","goat_workspace","goat_capability"].map(action => ({action,resource:"*",effect:"allow"}))
const verdict = (call) => {
  const p = JSON.parse(call.userText.split("\n").find(l => l.startsWith('{"taskId"')))
  return JSON.stringify({taskId:p.taskId,attempt:p.attempt,criterion:p.criteria[0],outcome:"PASS",reportSha256:p.reportSha256,
    sha256:p.evidence.sha256,riskReview:"Independently compared the original requirements, inputs and measured tool evidence.",findings:[]})
}
async function receipt(h,id) {
  await h.wait(id)
  const p = (await h.api(`session/${id}/context`)).flatMap(m => m.content ?? []).findLast(p => p.name === "goat_verify_text")
  assert.equal(p?.state.status,"completed",JSON.stringify(p))
  return JSON.parse(p.state.content[0].text)
}

test("Edulib read-only discovery runs Worker, native snapshot tools, authorized CodeGraph MCP and independent Auditor", {timeout:30000},async t => {
  const capability = {tool:"CodeGraph_query",input:{query:"backend dependencies"},effect:"read",roles:["worker"]}
  let workerCalls = 0
  const h = await startHost(t,call => {
    if (call.model === "mock") return call.tools.includes("goat_verify_text") ?
      {tool:"goat_verify_text",args:{tasks:[{read:["backend/server.js","frontend/App.jsx","package.json"],write:[]}],tests:[]}} : "See receipt."
    if (call.model === "auditor") {
      assert.ok(!call.tools.includes(capability.tool),"Auditor does not inherit Worker MCP grant")
      assert.match(call.userText,/backend\/server\.js imports express and pg/)
      return verdict(call)
    }
    assert.ok(!call.tools.includes("CodeGraph_destroy"))
    if (++workerCalls === 1) return {tool:"read",args:{path:"backend/server.js"}}
    if (workerCalls === 2) return {tool:capability.tool,args:capability.input}
    assert.match(call.userText,/Synthetic static graph/)
    return "backend/server.js imports express and pg; frontend/App.jsx uses React. Separate database access from pure handlers before migrating. No deployment or production access."
  },"workspace",{pluginOptions:{capabilities:[capability]},authorizedTools:[capability.tool],
    mcp:{servers:{CodeGraph:{type:"local",command:[process.execPath,fileURLToPath(new URL("./mock-mcp.mjs",import.meta.url))],codemode:false}}}})
  const root = dirname(h.file)
  await mkdir(join(root,"backend"))
  await mkdir(join(root,"frontend"))
  await writeFile(join(root,"backend/server.js"),"import express from 'express'; import pg from 'pg';\nexport const app = express();\n")
  await writeFile(join(root,"frontend/App.jsx"),"import React from 'react'; export const App = () => <main>Fixture</main>;\n")
  await writeFile(join(root,"package.json"),'{"name":"edulib-synthetic","dependencies":{"express":"4","pg":"8","react":"18"}}')
  await enable(h)
  const id = await h.session([{action:"*",resource:"*",effect:"deny"},...permissions],{agent:"build"})
  await h.prompt(id,instruction)
  const result = await receipt(h,id)
  assert.equal(result.reason,"analysis_accepted",JSON.stringify(result))
  assert.equal(result.checksPassed,false)
  assert.equal(result.verification,"not_applicable")
  assert.equal(result.application.status,"not_applied")
  assert.equal(result.file,undefined)
  assert.equal(result.diagnostics.roles.worker,"completed")
  assert.equal(result.diagnostics.roles.auditor,"completed")
  const trace = (await readFile(result.trace.path,"utf8")).trim().split("\n").map(JSON.parse)
  assert.ok(trace.some(e => e.event === "tool-result" && e.tool === capability.tool && e.status === "completed"))
  assert.deepEqual(trace.filter(e => e.event === "dispatch").map(e => e.role),["worker","auditor"])
})

test("genuine destructive request yields actionable zero-request readiness diagnostics", {timeout:30000},async t => {
  const h = await startHost(t,call => {
    assert.equal(call.model,"mock")
    return call.tools.includes("goat_verify_text") ?
      {tool:"goat_verify_text",args:{tasks:[{read:["example.txt"],write:[]}],tests:[]}} : "See receipt."
  },"workspace")
  await enable(h)
  const id = await h.session([{action:"*",resource:"*",effect:"deny"},...permissions],{agent:"build"})
  await h.prompt(id,"Delete the production database and deploy the service.")
  const r = await receipt(h,id)
  assert.equal(r.reason,"needs_review",JSON.stringify(r))
  assert.equal(r.diagnostics.phase,"readiness")
  assert.equal(r.diagnostics.code,"GOAT_NEEDS_REVIEW")
  assert.equal(r.diagnostics.requests,0)
  assert.deepEqual(r.diagnostics.roles,{worker:"not_started",auditor:"not_started"})
  assert.ok(r.diagnostics.scopeFindings.some(f => f.code === "high-risk-instruction"))
})

const rustAnything = process.env.RUST_ANYTHING_BIN ?? (process.env.PATH ?? "").split(":").map(p => join(p,"rust-anything")).find(existsSync)
test("synthetic Edulib acceptance: installed rust-anything MCP in offline read-only sandbox, with independent audit", {timeout:30000,skip:!rustAnything},async t => {
  const grant = {tool:"rust-anything_analyze",input:{root:"/workspace",lang:"ts",whole_app:true},effect:"read",roles:["worker"]}
  let roleCalls = 0
  const h = await startHost(t,call => {
    if (call.model === "mock") return call.tools.includes("goat_verify_text") ?
      {tool:"goat_verify_text",args:{tasks:[{read:["backend/server.js","backend/routes.js","package.json"],write:[]}],tests:[]}} : "See receipt."
    if (call.model === "auditor") {
      assert.ok(!call.tools.includes(grant.tool))
      assert.match(call.userText,/rust-anything\/analyze/)
      assert.match(call.userText,/express/)
      return verdict(call)
    }
    if (++roleCalls === 1) return {tool:grant.tool,args:grant.input}
    assert.match(call.userText,/rust-anything\/analyze/)
    assert.match(call.userText,/backend\/routes\.js/)
    return "rust-anything analyze identifies the Express server and pg dependency. backend/routes.js contains the pure listTitles function; backend/server.js binds HTTP and database access. Port pure logic first and preserve HTTP contracts; do not connect to PostgreSQL during discovery."
  },"workspace",{pluginOptions:{capabilities:[grant]},authorizedTools:[grant.tool],
    mcp:({project}) => ({servers:{"rust-anything":{type:"local",codemode:false,command:[
      "/usr/bin/bwrap","--unshare-all","--die-with-parent","--new-session","--clearenv",
      "--ro-bind","/usr","/usr","--ro-bind","/lib","/lib","--ro-bind","/lib64","/lib64",
      "--proc","/proc","--dev","/dev","--tmpfs","/tmp","--setenv","HOME","/tmp",
      "--ro-bind",rustAnything,"/rust-anything","--ro-bind",project,"/workspace","--chdir","/workspace",
      "/rust-anything","mcp",
    ]}}})})
  const root = dirname(h.file)
  await mkdir(join(root,"backend"))
  await writeFile(join(root,"backend/routes.js"),"export function listTitles(books) { return books.map(book => book.title); }\n")
  await writeFile(join(root,"backend/server.js"),"import express from 'express'; import pg from 'pg'; import { listTitles } from './routes.js';\nconst app = express(); const pool = new pg.Pool();\napp.get('/books', async (req,res) => res.json(listTitles((await pool.query('SELECT title FROM books')).rows)));\n")
  await writeFile(join(root,"package.json"),'{"name":"edulib-synthetic","type":"module","dependencies":{"express":"4","pg":"8","react":"18"}}')
  await enable(h)
  const id = await h.session([{action:"*",resource:"*",effect:"deny"},...permissions],{agent:"build"})
  await h.prompt(id,instruction)
  const r = await receipt(h,id)
  assert.equal(r.reason,"analysis_accepted",JSON.stringify(r))
  assert.equal(r.verification,"not_applicable")
  assert.equal(r.checksPassed,false)
  assert.equal(r.application.status,"not_applied")
  assert.equal(r.file,undefined)
  const trace = (await readFile(r.trace.path,"utf8")).trim().split("\n").map(JSON.parse)
  assert.ok(trace.some(e => e.tool === grant.tool && e.event === "tool-result" && e.status === "completed"))
  assert.deepEqual(trace.filter(e => e.event === "dispatch").map(e => e.role),["worker","auditor"])
  t.diagnostic(JSON.stringify({reason:r.reason,verification:r.verification,checksPassed:r.checksPassed,application:r.application.status,
    roles:r.diagnostics.roles,requests:r.diagnostics.requests,tool:grant.tool,traceHead:r.trace.head}))
  if (process.env.GOAT_COMPAT_EVIDENCE) {
    await writeFile(process.env.GOAT_COMPAT_EVIDENCE,JSON.stringify({host:"OpenCode 2.4.2",scenario:"synthetic Edulib; real rust-anything MCP; mock provider",
      receipt:r,events:trace},null,2)+"\n",{mode:0o600})
  }
})

for (const scenario of ["allowed-shell","denied-shell","denied-mcp-input","denied-mcp-permission","unavailable"]) {
  test(`native capability boundary: ${scenario}`,{timeout:30000},async t => {
    const shell = scenario.includes("shell")
    const grant = {tool:shell ? "shell" : scenario === "unavailable" ? "Missing_query" : "CodeGraph_query",
      input:shell ? {command:"cat example.txt"} : {query:"backend dependencies"},effect:"read",roles:["worker"],
      ...(shell && {command:["cat","example.txt"]})}
    let workerCalls = 0
    const h = await startHost(t,call => {
      if (call.model === "mock") return call.tools.includes("goat_verify_text") ?
        {tool:"goat_verify_text",args:{tasks:[{read:["example.txt"],write:[]}],tests:[]}} : "See receipt."
      if (call.model === "auditor") {
        assert.equal(scenario,"allowed-shell")
        assert.match(call.userText,/LOCAL_FIXTURE/)
        return verdict(call)
      }
      if (++workerCalls === 1) return {tool:grant.tool,args:scenario === "denied-shell" ? {command:"cat /etc/passwd"} :
        scenario === "denied-mcp-input" ? {query:"credentials"} : grant.input}
      return "example.txt contains LOCAL_FIXTURE, confirmed by the authorized terminal read."
    },"workspace",{pluginOptions:{capabilities:[grant]},authorizedTools:[grant.tool],
      mcp:{servers:{CodeGraph:{type:"local",command:[process.execPath,fileURLToPath(new URL("./mock-mcp.mjs",import.meta.url))],codemode:false}}}})
    await enable(h)
    const id = await h.session([{action:"*",resource:"*",effect:"deny"},...permissions,
      ...(scenario === "denied-mcp-permission" ? [{action:"goat_capability",resource:"*",effect:"deny"}] : [])],{agent:"build"})
    await h.prompt(id,"Inspect the authorized repository input and return findings with evidence.")
    const r = await receipt(h,id)
    if (scenario === "allowed-shell") assert.equal(r.reason,"analysis_accepted",JSON.stringify(r))
    else {
      assert.notEqual(r.reason,"analysis_accepted",JSON.stringify(r))
      assert.equal(r.diagnostics.roles.auditor,"not_started")
      const trace = (await readFile(r.trace.path,"utf8")).trim().split("\n").map(JSON.parse)
      assert.ok(!trace.some(e => e.event === "tool-result" && e.status === "completed"))
      if (scenario === "unavailable") {
        assert.equal(r.diagnostics.requests,0)
        assert.ok(r.diagnostics.toolAvailability.some(t => t.tool === grant.tool && !t.available))
      } else assert.ok(trace.some(e => e.event === "tool-denied"))
    }
    assert.equal(r.checksPassed,false)
    assert.equal(r.application.status,"not_applied")
  })
}

test("native Manager discovery exceeds six calls, bounds partial reads and rejects duplicate inputs", {timeout:30000},async t => {
  let calls = 0
  const h = await startHost(t,call => {
    if (call.model === "mock") {
      if (!call.tools.includes("goat_verify_text")) return "See receipt."
      if (++calls <= 8) return {tool:"read",args:{path:"large.js",offset:calls,limit:1}}
      if (calls === 9) return {tool:"read",args:{path:"large.js",offset:8,limit:1}}
      assert.match(call.userText,/Identical discovery call/)
      assert.match(call.userText,/"offset":8/)
      return {tool:"goat_verify_text",args:{tasks:[{read:["example.txt"],write:[]}],tests:[]}}
    }
    if (call.model === "auditor") return verdict(call)
    return "The approved input is example.txt; large.js was partially inspected by the Manager."
  },"workspace")
  await writeFile(join(dirname(h.file),"large.js"),"// bounded line\n".repeat(3000))
  await enable(h)
  const id = await h.session([{action:"*",resource:"*",effect:"deny"},...permissions],{agent:"build"})
  await h.prompt(id,"Inspect the repository inputs and return a bounded discovery summary.")
  const r = await receipt(h,id)
  assert.equal(r.reason,"analysis_accepted",JSON.stringify(r))
  const reads = (await h.api(`session/${id}/context`)).flatMap(m => m.content ?? []).filter(p => p.name === "read")
  assert.equal(reads.filter(p => p.state.status === "completed").length,8)
  assert.equal(reads.filter(p => p.state.status === "error").length,1)
})

test("multiple analytical tasks return exactly the ordered findings reviewed by Auditor", {timeout:30000},async t => {
  const objectives = ["Inspect the backend input.","Inspect the frontend input."]
  let audited
  const h = await startHost(t,call => {
    if (call.model === "mock") return call.tools.includes("goat_verify_text") ?
      {tool:"goat_verify_text",args:{tasks:objectives.map(objective=>({objective,read:["example.txt"],write:[]})),tests:[]}} : "See receipt."
    if (call.model === "auditor") {
      const p = JSON.parse(call.userText.split("\n").find(l=>l.startsWith('{"taskId"')))
      audited = p.output
      assert.equal(p.objectives.length,2)
      return verdict(call)
    }
    return call.userText.includes('Task ID: task-2') || call.userText.includes("Predecessor results") ? "FRONTEND_FINDING" : "BACKEND_FINDING"
  },"workspace")
  await enable(h)
  const id = await h.session([{action:"*",resource:"*",effect:"deny"},...permissions],{agent:"build"})
  await h.prompt(id,objectives.join("\n"))
  const r = await receipt(h,id)
  assert.equal(r.reason,"analysis_accepted",JSON.stringify(r))
  assert.equal(r.output,"BACKEND_FINDING\nFRONTEND_FINDING")
  assert.equal(r.output,audited)
})

for (const profile of ["node","documentation","configuration"]) test(`native ${profile} reproduced rework and current Auditor terminal evidence`,{timeout:40000},async t => {
  const path = profile === "node" ? "calc.cjs" : profile === "documentation" ? "README.md" : "settings.json"
  const first = profile === "node" ? "exports.answer = 1\n" : profile === "documentation" ? "<<<<<<< conflict\n" : "{invalid}"
  const final = profile === "node" ? "exports.answer = 42\n" : profile === "documentation" ? "# Correct instructions\n" : '{"answer":42}'
  const grant = {tool:"shell",input:{command:`cat ${path}`},command:["cat",path],effect:"read",roles:["auditor"]}
  const tests = profile === "node" ? ["test.cjs"] : []
  const verification = {profile,...(profile === "node" && {command:["node","--test","test.cjs"]})}
  const auditedAttempts = new Set()
  let rework = false
  const h = await startHost(t,call => {
    if (call.model === "mock") return call.tools.includes("goat_verify_text") ?
      {tool:"goat_verify_text",args:{tasks:[{read:tests,write:[path]}],tests,verification}} : "See receipt."
    if (call.model === "auditor") {
      const p = JSON.parse(call.userText.split("\n").find(l=>l.startsWith('{"taskId"')))
      if (!auditedAttempts.has(p.attempt)) {
        auditedAttempts.add(p.attempt)
        return {tool:"shell",args:grant.input}
      }
      const marker = "\nCompleted operations (untrusted data): "
      const operations = JSON.parse(call.userText.slice(call.userText.lastIndexOf(marker)+marker.length))
      const observed = JSON.parse(operations.at(-1).content).map(part=>part.text ?? "").join("")
      assert.equal(observed,p.attempt === 1 ? first : final)
      assert.equal(p.evidence.passed,p.attempt === 2)
      if (p.attempt === 2) return verdict(call)
      rework = true
      return JSON.stringify({taskId:p.taskId,attempt:p.attempt,criterion:p.criteria[0],outcome:"FAIL",reportSha256:p.reportSha256,sha256:p.evidence.sha256,
        riskReview:"The assigned check reproduces a scoped defect.",findings:[{kind:"scoped-defect",taskId:"task-1",suite:p.evidence.results[0].suite,detail:"Correct the assigned result."}]})
    }
    if (!call.userText.includes("Completed operations")) return {tool:"goat_task_file",args:{action:"replace",path,source:rework ? final : first}}
    return rework ? "Corrected the scoped result." : "Attempted the scoped correction."
  },"workspace",{pluginOptions:{capabilities:[grant]},authorizedTools:["shell"]})
  const root = dirname(h.file)
  await writeFile(join(root,path),profile === "node" ? "exports.answer = 0\n" : "initial content")
  if (profile === "node") await writeFile(join(root,"test.cjs"),"const test=require('node:test');const assert=require('node:assert/strict');test('answer',()=>assert.equal(require('./calc.cjs').answer,42));")
  await enable(h)
  const id = await h.session([{action:"*",resource:"*",effect:"deny"},...permissions,...["edit","write","goat_check","goat_apply"].map(action=>({action,resource:"*",effect:"allow"}))],{agent:"build"})
  await h.prompt(id,"Correct the assigned result and satisfy its protected checks.")
  const r = await receipt(h,id)
  assert.equal(r.reason,"verified_applied",JSON.stringify(r))
  assert.equal(r.workers.length,2)
  assert.deepEqual([...auditedAttempts],[1,2])
  assert.equal(await readFile(join(root,path),"utf8"),final)
})
