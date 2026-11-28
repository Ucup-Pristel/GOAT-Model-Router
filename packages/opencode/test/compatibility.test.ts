import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { decideTask, defaults } from "@goatmr/core"
import { provisionAnalysis, provisionProject } from "../src/project.js"
import { workspacePlan, readSnapshot, installWorkspace } from "../src/workspace.js"
import type { Plugin } from "@opencode/plugin"
import { capabilities, matchCapability, snapshotGlob } from "../src/capabilities.js"
import { failureDetails, readinessDetails } from "../src/diagnostics.js"
import { isolatedCommand, protectEmbeddedChecks, validateCommand, verificationCommand } from "../src/verification.js"

const ref = (modelID:string) => ({providerID:"fixture",modelID})
const config = {...defaults,enabled:true,models:{l1:ref("junior"),l2:ref("middle"),l3:ref("senior"),auditor:ref("auditor")}}
const instruction = "Investigate the Edulib backend repository. Analyze migration risks for a Rust backend. Do not deploy. Do not access production databases. Return findings with evidence."

test("Edulib analytical and negated instructions are ready; affirmative destructive actions remain protected",async () => {
  for (const text of [instruction,"Analyze migration risks for a Rust backend.","Inspect the backend repository. Do not deploy. Do not access production databases."]) {
    const plan = await decideTask({instruction:text,acceptanceCriteria:["Return findings with evidence."],config})
    assert.equal(plan.readiness,"ready",JSON.stringify(plan.scopeFindings))
    assert.equal(plan.intent.instruction,text)
  }
  for (const text of ["Delete the production database.","Analyze migration risks then delete the database.","Do not deploy; delete the production database.","Review migration by deleting production records.",
    "Analyze migration risks by running a production deployment","Read production credentials from the database","Audit security by modifying auth.js",
    "Review migration by first deleting production records."]) {
    const plan = await decideTask({instruction:text,acceptanceCriteria:["Return findings."],config})
    assert.equal(plan.readiness,"needs_review",text)
    assert.ok(readinessDetails(plan).reviewReasons.length)
  }
  const masked = await decideTask({instruction:"Review migration by first deleting production records.",
    acceptanceCriteria:["Return findings."],config,
    reasoner:{analyzeTask:()=>({complexity:"simple",risk:"low",contextNeed:"minimal",reasons:[],uncertainty:[]})}})
  assert.equal(masked.readiness,"needs_review")
  assert.ok(masked.scopeFindings.some(f=>f.code === "high-risk-instruction"))
})

test("analysis uses original input evidence without staging or writes",async () => {
  const task = workspacePlan("/synthetic",instruction,{tasks:[{read:["server.js"],write:[]}],tests:[]},Date.now()+60000)
  task.files[0].source = "export const backend = 'express'"
  const ws = provisionAnalysis(task,new AbortController().signal)
  assert.equal(ws.path,"")
  assert.equal(await ws.read("server.js"),task.files[0].source)
  await assert.rejects(ws.replace(),/read-only/)
  await assert.rejects(ws.read("outside"))
  const evidence = await ws.inspect()
  assert.equal(evidence.profile,"analysis")
  assert.deepEqual(evidence.results,[])
  assert.deepEqual(evidence.changes,[])
  assert.deepEqual(evidence.inputs,task.files)
})

test("verification protects tests and runner configuration even when omitted by Manager",() => {
  for (const path of ["test_a.py","a.test.js","tests/a.rs","package.json","Cargo.toml","build.rs","tsconfig.json","vitest.config.ts"]) {
    assert.throws(() => workspacePlan("/synthetic","Correct the current result.",{tasks:[{read:[],write:[path]}],tests:[]},1),/protected/,path)
  }
  for (const command of [["sh","-c","echo pass"],["node","-e","1"],["npm","install"],["cargo","test"],["node","--test","../outside.js"]]) {
    assert.throws(() => validateCommand(command[0] === "cargo" ? "rust" : "node",command))
  }
  for (const [profile,command] of [["node",["node","--test","--version"]],["typescript",["tsc","--noEmit","--help"]],["rust",["cargo","test","--offline","--help"]]] as const) {
    assert.throws(() => validateCommand(profile,[...command]))
  }
  assert.throws(() => verificationCommand({profile:"node",command:["npm","run","check"]},[
    {path:"package.json",source:'{"scripts":{"check":"node --test scripts/check.js"}}',role:"read"},
    {path:"scripts/check.js",source:"process.exit(0)",role:"edit"},
  ]),/protected/)
  assert.throws(() => protectEmbeddedChecks([{path:"src/lib.rs",role:"edit",source:"#[cfg(test)] mod checks {}"}]),/protected/)
})

for (const scenario of [
  {profile:"python" as const,path:"calc.py",before:"def answer(): return 0\n",after:"def answer(): return 42\n",tests:{"test_calc.py":"import unittest\nfrom calc import answer\nclass T(unittest.TestCase):\n def test_answer(self): self.assertEqual(answer(),42)\n"}},
  {profile:"node" as const,path:"calc.cjs",before:"exports.answer = 0\n",after:"exports.answer = 42\n",command:["node","--test","test_calc.cjs"],tests:{"test_calc.cjs":"const test = require('node:test');const assert = require('node:assert/strict');test('answer',()=>assert.equal(require('./calc.cjs').answer,42));"}},
  {profile:"typescript" as const,path:"calc.ts",before:"export const answer: number = 'wrong'\n",after:"export const answer: number = 42\n",command:["tsc","--noEmit","calc.ts"],tests:{}},
  {profile:"rust" as const,path:"src/lib.rs",before:"pub fn answer() -> u32 { 0 }\n",after:"pub fn answer() -> u32 { 42 }\n",command:["cargo","test","--offline","--locked"],tests:{"Cargo.toml":'[package]\nname="fixture"\nversion="0.1.0"\nedition="2021"\n',"Cargo.lock":'# protected lockfile\nversion = 3\n[[package]]\nname = "fixture"\nversion = "0.1.0"\n',"tests/answer.rs":"#[test] fn answer() { assert_eq!(fixture::answer(),42); }\n"}},
  {profile:"documentation" as const,path:"README.md",before:"",after:"# Corrected instructions\n",tests:{}},
  {profile:"configuration" as const,path:"settings.json",before:"{",after:'{"enabled":false}',tests:{}},
]) test(`${scenario.profile}: measured baseline fails, scoped correction passes`,async t => {
  const tests = Object.keys(scenario.tests)
  const task = workspacePlan("/synthetic","Correct the current result.",{tasks:[{read:tests,write:[scenario.path]}],tests:scenario.profile === "python" || scenario.profile === "node" ? tests : [],
    verification:{profile:scenario.profile,...(scenario.command && {command:scenario.command})}},Date.now()+60000)
  for (const f of task.files) f.source = f.path === scenario.path ? scenario.before : (scenario.tests as Record<string,string>)[f.path]
  const ws = await provisionProject(task,new AbortController().signal)
  t.after(() => rm(ws.path,{recursive:true,force:true}))
  await ws.replace(scenario.after,scenario.path)
  const result = await ws.inspect()
  assert.equal(result.baseline.every(r => r.passed),false,JSON.stringify(result))
  assert.equal(result.passed,true,JSON.stringify(result))
  assert.equal(result.changes.length,1)
})

test("isolated terminal cannot read host files, write inputs, use network or inherited credentials",async t => {
  const root = await mkdtemp(join(tmpdir(),"goat-isolation-"))
  t.after(() => rm(root,{recursive:true,force:true}))
  await writeFile(join(root,"test.cjs"),`
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
test('isolation',async ()=>{
 assert.throws(()=>fs.readFileSync('/etc/passwd'));
 assert.throws(()=>fs.writeFileSync('/workspace/escape','x'));
 assert.equal(process.env.GOAT_TEST_CREDENTIAL,undefined);
 await assert.rejects(fetch('http://127.0.0.1:1'));
});
`)
  process.env.GOAT_TEST_CREDENTIAL = "synthetic-secret"
  t.after(() => {delete process.env.GOAT_TEST_CREDENTIAL})
  assert.equal((await isolatedCommand(["node","--test","test.cjs"],root,new AbortController().signal)).passed,true)
  await assert.rejects(isolatedCommand(["sh","-c","true"],root,new AbortController().signal),/Unsupported/)
  const cancelled = AbortSignal.abort()
  await assert.rejects(isolatedCommand(["node","--test","test.cjs"],root,cancelled))
})

test("MCP grants require exact inputs and independent role selection",() => {
  const [grant] = capabilities({capabilities:[{tool:"rust-anything_analyze",input:{repo:"/workspace",write:false},effect:"read",roles:["worker"]}]})
  assert.equal(matchCapability([grant],grant.tool,{write:false,repo:"/workspace"}),grant)
  assert.throws(() => matchCapability([grant],grant.tool,{repo:"/",write:false}))
  assert.throws(() => matchCapability([grant],"CodeGraph_query",{}))
  assert.deepEqual(grant.roles,["worker"])
  for (const tool of ["execute","subagent","goat_verify_text","opencode_session_update","*"]) {
    assert.throws(() => capabilities({capabilities:[{...grant,tool}]}))
  }
})

test("snapshot glob remains bounded for repeated wildcards and long names",() => {
  assert.equal(snapshotGlob("a*".repeat(60)+"z","a".repeat(500)+"y"),false)
  assert.equal(snapshotGlob("src/*.?s","src/calc.ts"),true)
  assert.equal(snapshotGlob("*.rs","calc.ts"),false)
  assert.throws(() => workspacePlan("/synthetic","Inspect the repository inputs.",{tasks:[{read:Array.from({length:129},(_,i)=>`file-${i}.txt`),write:[]}],tests:[]},1),/128-file/)
})

test("diagnostics never include raw errors and large reads enforce scoped limits",async t => {
  const d = failureDetails(Error("Authorization: Bearer synthetic-secret"),"worker")
  assert.equal(d.code,"GOAT_PERMISSION_DENIED")
  assert.doesNotMatch(JSON.stringify(d),/Bearer|synthetic-secret/)
  const root = await mkdtemp(join(tmpdir(),"goat-ranges-"))
  t.after(() => rm(root,{recursive:true,force:true}))
  await writeFile(join(root,"large.ts"),"line\n".repeat(5000))
  await assert.rejects(readSnapshot(root,"large.ts",new AbortController().signal))
  assert.equal(await readSnapshot(root,"large.ts",new AbortController().signal,{offset:1000,limit:2}),"line\nline")
  await assert.rejects(readSnapshot(root,"large.ts",new AbortController().signal,{offset:0,limit:2}))
})

test("a Manager read admitted before cancellation never falls back to the live filesystem after OFF",async t => {
  const root = await mkdtemp(join(tmpdir(),"goat-cancel-read-"))
  t.after(() => rm(root,{recursive:true,force:true}))
  await writeFile(join(root,"README.md"),"approved snapshot")
  let enabled = true, nativeReads = 0
  const sessionHooks = new Map<string,(e:any)=>Promise<void>>()
  const toolHooks = new Map<string,(e:any)=>Promise<void>>()
  const readTool:any = {execute:async()=>{nativeReads++;return {content:"live filesystem"}}}
  const session = {id:"parent",agent:"build",location:{directory:root},permissions:[],model:{providerID:"fixture",id:"manager"}}
  const ctx = {
    location:{directory:root},storage:{get:async()=>({...config,enabled})},
    session:{get:async()=>session,hook:async(name:string,fn:any)=>{sessionHooks.set(name,fn)}},
    permission:{assert:async()=>{}},
    tool:{hook:async(name:string,fn:any)=>{toolHooks.set(name,fn)},transform:async(fn:any)=>fn({add:()=>{},update:(_name:string,update:any)=>update(readTool)})},
  } as unknown as Plugin.Context
  const workspace = await installWorkspace(ctx,async()=>{throw Error("unexpected dispatch")})
  await sessionHooks.get("prompt")!({sessionID:"parent",messageID:"user",prompt:{text:"Inspect the approved repository input."}})
  await toolHooks.get("execute.before")!({sessionID:"parent",tool:"read",id:"admitted",input:{path:"README.md"}})
  workspace.cancel()
  enabled = false
  await sessionHooks.get("prompt")!({sessionID:"parent",messageID:"off-user",prompt:{text:"Native request after OFF"}})
  await assert.rejects(readTool.execute({path:"README.md"},{sessionID:"parent",id:"admitted",signal:new AbortController().signal}))
  assert.equal(nativeReads,0)
  await readTool.execute({path:"README.md"},{sessionID:"parent",id:"native",signal:new AbortController().signal})
  assert.equal(nativeReads,1)
})
