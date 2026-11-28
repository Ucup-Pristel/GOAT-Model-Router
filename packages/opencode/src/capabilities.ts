import { isDeepStrictEqual } from "node:util"

export type Capability = {tool:string; input:Record<string,unknown>; effect:"read"; roles:("worker"|"auditor")[]; command?:string[]}

// Host/operator options only. A proposal or child prompt cannot create grants.
// MCP declarations are an explicit trust decision about the server implementation,
// not an inference from its name or its readOnlyHint.
export function capabilities(options: Record<string,unknown>): Capability[] {
  const value = options.capabilities ?? []
  if (!Array.isArray(value) || value.length > 16) throw Error("Invalid host capabilities")
  const grants = value.map(v => {
    if (!v || typeof v !== "object" || Object.keys(v).some(k => !["tool","input","effect","roles","command"].includes(k)) ||
        typeof v.tool !== "string" || !/^[\w-]{1,128}$/.test(v.tool) ||
        /^(?:goat|opencode)[_-]|^(?:execute|subagent|skill|question|automation|patch|write|edit|read|glob|grep)$/.test(v.tool) ||
        v.effect !== "read" || !v.input || typeof v.input !== "object" || Array.isArray(v.input) ||
        JSON.stringify(v.input).length > 4096 ||
        !Array.isArray(v.roles) || !v.roles.length || v.roles.some((r:unknown) => r !== "worker" && r !== "auditor") ||
        v.tool !== "shell" && v.command !== undefined ||
        v.tool === "shell" && (!Array.isArray(v.command) || !v.command.length)) throw Error("Invalid host capability; explicit read effects and role grants required")
    return structuredClone(v) as Capability
  })
  for (const [i,g] of grants.entries()) {
    if (grants.slice(0,i).some(p => p.tool === g.tool && isDeepStrictEqual(p.input,g.input))) throw Error("Ambiguous duplicate host capability")
  }
  return grants
}

export function matchCapability(grants: readonly Capability[], tool:string, input:unknown) {
  const grant = grants.find(g => g.tool === tool && isDeepStrictEqual(g.input,input))
  if (!grant) throw Error("Tool invocation outside exact host capability")
  return grant
}

// O(pattern.length * path.length), bounded by the input/path limits. A model
// pattern must never become a backtracking regex on the host event loop.
export function snapshotGlob(pattern:string, path:string) {
  let p = 0, n = 0, star = -1, retry = 0
  while (n < path.length) {
    if (pattern[p] === "?" || pattern[p] === path[n]) { p++; n++ }
    else if (pattern[p] === "*") { star = p++; retry = n }
    else if (star < 0) return false
    else { p = star+1; n = ++retry }
  }
  while (pattern[p] === "*") p++
  return p === pattern.length
}
