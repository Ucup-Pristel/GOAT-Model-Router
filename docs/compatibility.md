# OpenCode compatibility

The public beta installation target is **OpenCode 2.4.2, Linux x86-64, terminal UI**. The [package lifecycle test](../tests/milestone/packaging.test.mjs) exercises global install, update, removal and project-local loading. The adapter has no desktop GUI commands.

Earlier regression tests exercised the single-file Python coding profile against three native host versions using a local mock provider:

| OpenCode version | Earlier milestone tests (pass / fail / skip) | Protected checks after one rework | TUI controls without model requests |
|---|---:|---:|---|
| 2.3.2 | 120 / 0 / 10 | 4/4 | Passed |
| 2.4.1 | 120 / 0 / 10 | 4/4 | Passed |
| 2.4.2 | 120 / 0 / 10 | 4/4 | Passed |

These results cover plugin loading, RPC, model selection, ordinary Build prompts and child sessions. They do not establish beta package lifecycle support on the two earlier hosts. The development SDK is pinned to `@opencode/plugin@2.3.2`; the running host supplies the plugin API.

## Workspace verifier

Python verification still requires `/usr/bin/python3`, `/proc`, Landlock ABI ≥3 and `libseccomp.so.2`. Checkout application still uses the protected Linux Python helper, regardless of source language. Native `glob` needs OpenCode's ripgrep helper. macOS/Windows write-back and ARM execution are not validated.

Node, TypeScript and Rust checks use `/usr/bin/bwrap`, `/usr/bin/systemd-run` and `/usr/bin/prlimit`. A functioning user systemd manager with memory/PID controllers is required. A trusted helper verifies the actual cgroup limits before launching project code. Each check runs offline in namespaces, with no inherited environment, HOME, credentials or original checkout. Inputs and runtime trees are read-only; writable tmpfs trees are capped at 64 MiB and 256 MiB. A transient scope caps total memory at 512 MiB, swap at zero, tasks at 32, runtime at 15 seconds. No host fallback exists.

System executables are fixed: `/usr/bin/node`, `/usr/bin/cargo`, `/usr/bin/gcc`. TypeScript uses the installed `typescript` package resolved alongside the adapter; a missing compiler fails closed. Dependencies must be present in the approved snapshot/toolchain; GOAT neither installs packages nor accesses registries. Large/dependency-heavy projects can therefore be unsupported even when their language has a profile.

Documentation and JSON checks require no Python test suite; read-only analysis requires neither a test suite nor checkout staging. See [verification](verification.md) and the [patch report](runtime-compatibility-patch.md).

## Native tools and MCP

The implementation uses real `@opencode/plugin@2.3.2` APIs, tested on OpenCode **2.4.2**: `ctx.tool.list/transform/hook`, session creation/context/permissions, request hooks and `ctx.permission.assert`. It does not use a fabricated MCP execution or host sandbox API.

Workers receive native `read`/`glob` names backed by their assigned snapshots; scoped edits still use `goat_task_file`. Original checkout native editing is not granted. Child identity, parent, model, permissions, depth and request budget remain bound throughout execution. Recursive GOAT, subagents, Code Mode and permission-management tools are unavailable to children.

External tool grants are opt-in plugin **operator options**, separate from model proposals and `/goat on`:

```jsonc
{
  "plugins": [{
    "package": "@goatmr/opencode",
    "options": {
      "capabilities": [{
        "tool": "rust-anything_analyze",
        "input": { "root": "/workspace", "lang": "ts", "whole_app": true },
        "effect": "read",
        "roles": ["worker"]
      }]
    }
  }]
}
```

Use actual installed catalog IDs and exact inputs. `/workspace` above must be the server's independently sandboxed repository path, not an assumed OpenCode API. Unavailable catalog entries fail before role requests. Each call also checks the parent `goat_capability` permission. Auditor grants are explicit and separate. A `shell` grant additionally supplies `command: ["cat", "relative/file"]` or `["wc", "-l", "relative/file"]`; the actual argv and role snapshot are included in authorization, and the command uses the same offline/resource-bounded runner.

**MCP trust boundary:** OpenCode executes MCP servers outside GOAT's process sandbox. An operator must vet effects and confine local servers (or use a service with independently enforced scope). A name or `readOnlyHint` is not sufficient. `effect: "read"` is an explicit operator classification plus per-call permission, not proof of server isolation. GOAT cannot safely admit untrusted/mutating MCP operations or promise containment of a misconfigured remote service. The acceptance fixture launches the real rust-anything server in its own network-disabled, read-only bubblewrap sandbox; CodeGraph transport uses a synthetic mock server.

The new ordinary workspace path still targets Standard Build sessions. Existing signed Resink planning remains covered by regression tests; ordinary Resink workspace admission has not been expanded.
