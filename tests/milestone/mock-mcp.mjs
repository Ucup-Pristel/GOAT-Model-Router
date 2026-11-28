// Isolated protocol fixture; neither network nor repository execution.
import { createInterface } from "node:readline"
for await (const line of createInterface({input:process.stdin})) {
  const r = JSON.parse(line)
  if (r.id === undefined) continue
  let result
  if (r.method === "initialize") result = {protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:"CodeGraph-fixture",version:"1"}}
  else if (r.method === "tools/list") result = {tools:[{name:"query",description:"Synthetic static graph query",inputSchema:{type:"object",properties:{query:{type:"string"}},required:["query"]}},
    {name:"destroy",description:"Forbidden fixture operation",inputSchema:{type:"object",properties:{}}}]}
  else if (r.method === "tools/call" && r.params.name === "query") result = {content:[{type:"text",text:"backend/server.js imports express and pg; frontend/App.jsx is React. Synthetic static graph."}]}
  else if (r.method === "tools/call") throw Error("UNAUTHORIZED_MCP_REACHED_SERVER")
  else result = {}
  process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:r.id,result})+"\n")
}
