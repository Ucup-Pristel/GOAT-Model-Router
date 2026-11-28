import { execFile } from "node:child_process"
import { access } from "node:fs/promises"
import { dirname } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import type { ProjectFile } from "@goatmr/core"

export type VerificationProfile = "python" | "node" | "typescript" | "rust" | "documentation" | "configuration" | "analysis" | "unsupported"
export type Verification = { profile: VerificationProfile; command?: string[]; protected?: string[] }

// Test and runner definitions are policy, even when omitted from tests by a model.
export const protectedDefinition = (path: string) =>
  /(^|\/)(?:tests?|__tests__|fixtures)(\/|$)|(^|\/)(?:test_.+|.+_test)\.py$|\.(?:test|spec)\.[cm]?[jt]sx?$|(^|\/)(?:package(?:-lock)?\.json|[a-z]+\.lock|Cargo\.(?:toml|lock)|build\.rs|tsconfig[^/]*\.json|(?:jest|vitest|vite|webpack|eslint|babel)[^/]*|Makefile|pyproject\.toml|pytest\.ini|tox\.ini|opencode\.jsonc?|AGENTS\.md)$/i.test(path)

export function protectEmbeddedChecks(files: readonly ProjectFile[]) {
  // Conservative boundary: no partial-source parser. Test-bearing source must
  // be separated by the Owner before a Worker can replace the implementation.
  for (const f of files) if (f.role === "edit" && f.source &&
      (f.path.endsWith(".rs") && /#\s*\[\s*(?:test|cfg\s*\(\s*test\s*\))\s*\]/.test(f.source) ||
       /\.[cm]?[jt]sx?$/.test(f.path) && /(?:node:test|@jest\/globals|from\s*["'](?:vitest|jest)["'])/.test(f.source) ||
       f.path.endsWith(".py") && /\b(?:unittest|pytest)\b/.test(f.source))) throw Error("Embedded protected test definitions cannot be replaced")
}

export function selectVerification(writes: string[], tests: string[], requested?: Verification): Verification {
  const profile = requested?.profile ?? (!writes.length ? "analysis" :
    tests.length && tests.every(p => p.endsWith(".py")) ? "python" :
    writes.every(p => /\.(?:md|txt|rst)$/i.test(p)) ? "documentation" :
    writes.every(p => /\.json$/i.test(p)) ? "configuration" : "unsupported")
  if (!["python","node","typescript","rust","documentation","configuration","analysis","unsupported"].includes(profile)) throw Error("Invalid verification profile")
  if (profile === "analysis" && writes.length || !writes.length && profile !== "analysis") throw Error("Analysis requires zero write targets")
  if (profile === "documentation" && !writes.every(p => /\.(?:md|txt|rst)$/i.test(p)) ||
      profile === "configuration" && !writes.every(p => /\.json$/i.test(p))) throw Error("Verification profile does not cover write targets")
  if (["node","typescript","rust"].includes(profile)) validateCommand(profile, requested?.command)
  else if (requested?.command) throw Error("This verification profile does not accept commands")
  return {profile, ...(requested?.command && {command:[...requested.command]}), ...(requested?.protected && {protected:[...requested.protected]})}
}

export function validateCommand(profile: string, command?: string[]): asserts command is string[] {
  if (!Array.isArray(command) || !command.length || command.length > 32 ||
      command.some(s => typeof s !== "string" || !s.length || s.length > 512 || /[\0\r\n]/.test(s))) throw Error("Invalid verification command")
  const [program,...args] = command
  const allowed = profile === "node" ? ["node","npm"] : profile === "typescript" ? ["tsc","npm"] : profile === "rust" ? ["cargo"] : []
  if (!allowed.includes(program) || !args.length) throw Error("Unsupported verification command")
  if (program === "npm" && !(args.length === 1 && args[0] === "test" || args.length === 2 && args[0] === "run" && /^[\w:-]+$/.test(args[1]))) throw Error("Only an exact existing npm test/run script is supported")
  const path = (s:string) => /^[\w-][\w./-]*$/.test(s) && !s.includes("..")
  if (program === "node" && !(args[0] === "--test" && args.length > 1 && args.slice(1).every(s => path(s) && /\.[cm]?js$/.test(s)))) throw Error("Node checks require explicit protected test paths")
  if (program === "tsc" && !(args[0] === "--noEmit" && args.length > 1 &&
      (args[1] === "--project" ? args.length === 3 && path(args[2]) && args[2].endsWith(".json") : args.slice(1).every(s => path(s) && s.endsWith(".ts"))))) throw Error("TypeScript checks require explicit files or protected project config")
  if (program === "cargo" && !(["test","check"].includes(args[0]) && args.includes("--offline") && args.includes("--locked") &&
      args.slice(1).every(a => ["--offline","--locked"].includes(a)))) throw Error("Cargo checks require offline locked execution without extra flags")
}

export function verificationCommand(profile: Verification, files: readonly ProjectFile[]) {
  if (!profile.command) return undefined
  validateCommand(profile.profile,profile.command)
  let command = profile.command
  if (command[0] === "npm") {
    const file = files.find(f => f.path === "package.json" && f.role !== "edit")
    if (!file?.source) throw Error("Missing protected package.json")
    const pkg = JSON.parse(file.source)
    const name = command[1] === "test" ? "test" : command[2]
    const script = pkg.scripts?.[name]
    if (typeof script !== "string" || /[;&|$`"'\\\n\r<>]/.test(script)) throw Error("Unsupported project script; use a directly supported protected check")
    command = script.trim().split(/\s+/)
    // Resolve the existing script to a direct argv; never run lifecycle hooks.
    if (command[0] === "npm") throw Error("Recursive verification script")
    validateCommand(profile.profile,command)
  }
  const protectedFile = (path:string) => files.some(f => f.path === path && f.role !== "edit" && f.source !== null)
  if (command[0] === "node" && !command.slice(2).every(protectedFile)) throw Error("Verification test entrypoint must be protected")
  if (command[0] === "tsc" && command[2] === "--project" && !protectedFile(command[3])) throw Error("Verification configuration must be protected")
  if (command[0] === "cargo" && (!protectedFile("Cargo.toml") || !protectedFile("Cargo.lock"))) throw Error("Cargo manifest and lockfile must be protected")
  return command
}

export function validateTerminal(command: string[]) {
  const [program,...args] = command
  const files = program === "wc" && args[0] === "-l" ? args.slice(1) : args
  if (!["cat","wc"].includes(program) || !files.length || files.length > 16 ||
      files.some(p => !/^[\w-][\w./-]*$/.test(p) || p.includes(".."))) throw Error("Unsupported scoped terminal command")
}

// No shell, inherited environment, home, original checkout or network. bwrap
// must establish all namespaces; failure never falls back to a host process.
export async function isolatedCommand(command: string[], cwd: string, signal: AbortSignal) {
  const program = command[0]
  if (program === "cat" || program === "wc") validateTerminal(command)
  else validateCommand(program === "cargo" ? "rust" : program === "tsc" ? "typescript" : "node",command)
  let executable = `/usr/bin/${program}`
  const argv = command.slice(1)
  const mounts: string[] = []
  if (program === "tsc") {
    let compiler: string
    try { compiler = createRequire(import.meta.url).resolve("typescript/package.json") }
    catch { throw Error("TypeScript verifier unavailable") }
    mounts.push("--ro-bind",dirname(compiler),"/compiler")
    executable = "/usr/bin/node"
    argv.unshift("/compiler/bin/tsc")
  }
  if (program === "cargo") mounts.push("--setenv","RUSTFLAGS","-C linker=/usr/bin/gcc")
  try { await access(executable) } catch { throw Error("Verification executable unavailable") }
  const args = ["--unshare-all","--unshare-user","--disable-userns","--die-with-parent","--new-session","--clearenv",
    "--ro-bind","/usr","/usr","--ro-bind","/lib","/lib","--ro-bind","/lib64","/lib64",
    "--proc","/proc","--dev","/dev","--size","67108864","--tmpfs","/tmp","--size","268435456","--tmpfs","/work",
    "--ro-bind",cwd,"/workspace","--chdir","/workspace","--setenv","HOME","/tmp",
    "--setenv","PATH","/usr/bin:/bin","--setenv","CARGO_TARGET_DIR","/work/target",
    "--setenv","CARGO_HOME","/tmp/cargo","--setenv","CARGO_BUILD_JOBS","1","--setenv","RUST_TEST_THREADS","1",...mounts]
  return new Promise<{passed:boolean; output:string}>((resolve,reject) => {
    execFile("/usr/bin/systemd-run",["--user","--scope","--quiet","--collect",
      "-p","MemoryMax=512M","-p","MemorySwapMax=0","-p","TasksMax=32","-p","RuntimeMaxSec=15s",
      "/usr/bin/python3","-ISB",fileURLToPath(new URL("./check-limits.py",import.meta.url)),
      "/usr/bin/bwrap",...args,"/usr/bin/prlimit","--cpu=10","--fsize=67108864","--nofile=128","--",executable,...argv],{
      cwd:"/",env:{XDG_RUNTIME_DIR:`/run/user/${process.getuid!()}`},signal,timeout:17000,killSignal:"SIGKILL",maxBuffer:32768,
    },(error,stdout,stderr) => {
      if (signal.aborted) return reject(signal.reason)
      resolve({passed:!error,output:(stdout+stderr).slice(0,32768)})
    })
  })
}
