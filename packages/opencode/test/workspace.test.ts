import assert from "node:assert/strict"
import {link,mkdir,mkdtemp,open,readFile,rm,symlink,writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import test, {type TestContext} from "node:test"
import {applyWorkspace,readSnapshot,workspacePlan} from "../src/workspace.js"
import {digest} from "@goat/core"

test("workspace assignments do not depend on prompt syntax, extensions, or number of files", () => {
  const paths = Array.from({length:25},(_,i) => `lib/group ${i}/index.ts`)
  const task = workspacePlan("/demo","Fix the rounding issue.",{tasks:[{read:[],write:paths}],tests:[]},1)
  assert.equal(task.schedule?.tasks.length,1)
  assert.equal(task.files.length,25)
  assert.deepEqual(task.userPlan,[task.instruction])
})

test("Standard multi-task scopes preserve original objectives, validate dependencies and protect tests", () => {
  const tasks = [{objective:"Fix totals",read:[],write:["totals.js"]},
    {objective:"update the UI",read:["totals.js"],write:["view.js"]}]
  const plan = () => workspacePlan("/demo","Fix totals then update the UI.",{tasks,tests:["test_view.py"]},1)
  assert.deepEqual(plan().schedule?.tasks[1].dependsOn,["task-1"])
  assert.throws(() => workspacePlan("/demo","Fix totals.",{tasks,tests:[]},1),/OriginalIntent/)
  assert.throws(() => workspacePlan("/demo","Independently: Fix totals and update the UI.",{tasks:[tasks[0],{...tasks[1],dependsOn:[],independence:"Independently"}],tests:[]},1),/conflict/)
  assert.deepEqual(workspacePlan("/demo","Fix totals then update the UI.",{tasks:[tasks[0],{...tasks[1],dependsOn:[]}],tests:[]},1).schedule?.tasks[1].dependsOn,["task-1"])
  tasks[0].write = ["test_view.py"]
  assert.throws(plan,/protected/)
})

test("workspace snapshot rejects traversal, links, secrets and cancelled reads",async t => {
  const root = await mkdtemp(join(tmpdir(),"goat-workspace-"))
  t.after(() => rm(root,{recursive:true,force:true}))
  await mkdir(join(root,"src"))
  await writeFile(join(root,"src","a.ts"),"example")
  const controller = new AbortController()
  const read = (name:string) => readSnapshot(root,name,controller.signal)
  assert.equal(await read("src/a.ts"),"example")
  assert.equal(await read("new/directory/new.js"),null)
  await symlink(join(root,"src"),join(root,"alias"))
  await link(join(root,"src","a.ts"),join(root,"b.ts"))
  await writeFile(join(root,"key.txt"),'password = "secret"')
  for (const path of ["../outside.ts","alias/a.ts","b.ts","src/a.ts",".env","key.txt"]) await assert.rejects(read(path))
  controller.abort()
  await assert.rejects(read("new.js"),{name:"AbortError"})
})

test("workspace proposal errors name the invalid field before dispatch", () => {
  const task = {read:[],write:["src/calc.py"]}
  const plan = (overrides:Partial<typeof task> & {dependsOn?:string[]}, tests:string[] = []) =>
    workspacePlan("/demo","Fix the calculator.",{tasks:[{...task,...overrides}],tests},1)
  assert.throws(() => plan({read:undefined}),/tasks\[0\]\.read: expected an array/)
  assert.throws(() => plan({write:[]}),/tasks\[0\]\.write: specify at least one/)
  assert.throws(() => plan({dependsOn:["task-1"]}),/tasks\[0\]\.dependsOn.*task-1.*use \[\]/)
  assert.throws(() => plan({},["../test_calc.py"]),/tests\[0\].*\.\.\/test_calc.py/)
  assert.throws(() => plan({write:["tests/custom.py"]},["tests/custom.py"]),/tasks\[0\]\.write: tests\/custom.py is a protected test/)
  const [suite] = plan({},["tests/test_calc.py"]).files.filter(f => f.role === "test")
  assert.equal(suite.path,"tests/test_calc.py")
})

async function writebackFixture(t:TestContext) {
  const root = await mkdtemp(join(tmpdir(),"goat-checkout-"))
  t.after(() => rm(root,{recursive:true,force:true}))
  const stage = join(root,"stage")
  const task = workspacePlan(root,"Correct the results.",{tasks:[{read:[],write:["a.txt","sub/b.txt"]}],tests:["test_calc.py"]},Date.now()+60000)
  await mkdir(join(stage,"sub"),{recursive:true})
  for (const f of task.files) {
    f.source = f.role === "test" ? "protected" : f.path === "a.txt" ? "# local change\n0\n" : null
    if (f.source !== null) await writeFile(join(root,f.path),f.source)
  }
  const changes = task.files.filter(f => f.role === "edit").map(f => {
    const after = f.source ? "# local change\n42\n" : "new\n"
    return {path:f.path,before:f.source,after,sha256:digest(after)}
  })
  for (const c of changes) await writeFile(join(stage,c.path),c.after)
  await writeFile(join(stage,"test_calc.py"),"protected")
  await writeFile(join(root,"notes"),"unrelated local edit")
  const result = {status:"completed",reason:"accepted",workspaceFile:stage,
    evidence:{passed:true,results:[{count:1,passed:true}],changes,sha256:digest(JSON.stringify(changes))}}
  const controller = new AbortController()
  async function apply(authorize = async () => {}, current = async () => {}) {
    return applyWorkspace(task,result,controller.signal,authorize,current)
  }
  return {apply,root,stage,result,controller}
}

test("write-back verifies existing and new checkout files and preserves other inputs",async t => {
  const {apply,root,stage} = await writebackFixture(t)
  const receipt = await apply()
  assert.equal(receipt.status,"applied",receipt.detail)
  assert.deepEqual(receipt.applied,["a.txt","sub/b.txt"])
  assert.deepEqual(receipt.unapplied,[])
  assert.deepEqual(receipt.createdDirectories,["sub"])
  for (const path of [...receipt.applied,"test_calc.py"]) assert.deepEqual(await readFile(join(root,path)),await readFile(join(stage,path)))
  assert.equal(await readFile(join(root,"notes"),"utf8"),"unrelated local edit")
})

test("write-back rejects changed inputs, changed staging and unsuccessful verification",async t => {
  const {apply,root,stage,result} = await writebackFixture(t)
  result.reason = "rejected"
  assert.equal((await apply(async () => assert.fail("unverified write authorized"))).status,"staged")
  result.reason = "accepted"
  result.evidence.passed = false
  assert.deepEqual((await apply(async () => assert.fail("failed checks authorized"))).applied,[])
  result.evidence.passed = true
  const conflict = await apply(async () => { await writeFile(join(root,"test_calc.py"),"external edit") })
  assert.deepEqual(conflict.conflicts,["test_calc.py"])
  assert.deepEqual(conflict.applied,[])
  await writeFile(join(stage,"a.txt"),"tampered after review")
  const tampered = await apply()
  assert.match(tampered.detail!,/Staging changed/)
  assert.equal(await readFile(join(root,"a.txt"),"utf8"),"# local change\n0\n")
})

test("write-back stops on cancellation without publishing a later file",async t => {
  const {apply,controller,root} = await writebackFixture(t)
  let calls = 0
  const partial = await apply(undefined,async () => {
    if (++calls === 2) controller.abort()
  })
  assert.equal(partial.status,"partial",partial.detail)
  assert.deepEqual(partial.applied,["a.txt"])
  assert.deepEqual(partial.unapplied,["sub/b.txt"])
  assert.equal(await readFile(join(root,"a.txt"),"utf8"),"# local change\n42\n")
  await assert.rejects(readFile(join(root,"sub/b.txt")),{code:"ENOENT"})
})

test("write-back never overwrites an active writer or rolls back a concurrent edit",async t => {
  const {apply,root} = await writebackFixture(t)
  const active = await open(join(root,"a.txt"),"r+")
  try {
    const busy = await apply()
    assert.equal(busy.status,"conflict",busy.detail)
    assert.deepEqual(busy.applied,[])
    assert.deepEqual(busy.conflicts,["a.txt"])
  } finally { await active.close() }
  let checks = 0
  const race = await apply(undefined,async () => {
    if (++checks === 2) {
      await writeFile(join(root,"a.txt"),"user edit after first write")
      await mkdir(join(root,"sub"))
      await writeFile(join(root,"sub/b.txt"),"user-created file")
    }
  })
  assert.equal(race.status,"partial")
  assert.deepEqual(race.written,["a.txt"])
  assert.deepEqual(race.applied,[])
  assert.deepEqual(race.conflicts,["a.txt","sub/b.txt"])
  assert.equal(await readFile(join(root,"a.txt"),"utf8"),"user edit after first write")
  assert.equal(await readFile(join(root,"sub/b.txt"),"utf8"),"user-created file")
})
