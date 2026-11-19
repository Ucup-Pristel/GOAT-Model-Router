# GOAT Model Router

Open-source, model-agnostic orchestration plugin for OpenCode V2. GOAT is currently a **configuration and control plane only**: it can select models for Manager, L1/L2/L3, and Auditor, choose Standard or Resink mode, and persist ON/OFF. Worker routing, task planning, auditing, retries, and escalation are **not implemented yet**.

GOAT defaults **OFF**. While OFF, the plugin only owns the `/goat` TUI command; it does not intercept normal prompts, create sessions, or call models.

## Commands

Exactly one public slash command is registered: `/goat`.

| Command | Behavior |
|---|---|
| `/goat router` | Opens a provider/model picker for Manager, L1, L2, L3, and Auditor. Manager can inherit the current session model. |
| `/goat mode` | Selects Standard or Resink. Resink only stores the mode in Task 1; no planner runs. |
| `/goat on` | Persists `enabled: true`. Does not start orchestration. |
| `/goat off` | Persists `enabled: false`. Native OpenCode behavior remains unchanged. |
| `/goat status` | Reports persisted state, mode, role assignments, and model availability. |

OpenCode V2 TUI slash commands and server commands are separate. The TUI command calls a typed server RPC contract (`Rpc.define`) over `context.client.rpc(Goat)`; no duplicate server `/goat` command is registered. Settings are stored in plugin-scoped server storage, not global OpenCode configuration.

## Requirements

- Node.js 22.19+ (verified with 22.23.5)
- npm 10+
- OpenCode V2 `2.3.2` (plugin API is beta; exact SDK version is pinned)

## Local checks

```sh
npm install
npm run check
npm test
```

## Isolated plugin loading

Do not install globally. In a disposable OpenCode project, copy this repository's `packages/opencode` directory to a real directory such as `.opencode/plugins/goat`, then add it to that project's `opencode.jsonc`:

```jsonc
{
  "plugins": ["./.opencode/plugins/goat"]
}
```

The plugin directory must be real, not a symlink. `@goat/core` and `@goat/opencode` must resolve from the isolated project, and `@opencode/plugin` must resolve from the plugin directory. Start the host with isolated `HOME`, `XDG_CONFIG_HOME`, and `OPENCODE_CONFIG` so no user-level OpenCode configuration is touched.

Verify `/goat status` in the real TUI, then exercise router, mode, on, and off. Keep credentials out of test fixtures. This repository does not modify global OpenCode configuration.

## Layout

- `packages/core`: host-independent lifecycle and configuration contracts, defaults, validation, and model status formatting.
- `packages/opencode`: server plugin (RPC handlers + storage) and TUI plugin (single `/goat` command), with shared RPC contract.
- `docs/architecture.md`: architecture, state lifecycle, safeguards, and roadmap.
- `docs/task-1a-preflight.md`: host integration evidence, RPC root-cause fix, and dependency audit.
- `docs/auditor-report.md`: independent Auditor verdicts.

## Current limitations

- Task 1 does not route work or invoke worker/auditor models.
- `/goat on` is an opt-in flag only; orchestration remains unimplemented.
- Standard and Resink differ only in persisted mode during Task 1.
- Model assignments are validated against the live provider inventory when saved; status flags models that later become unavailable.
- Configuration storage is scoped to the plugin installation/location, not synchronized across projects.
- 24 moderate dependency advisories remain in the pinned SDK graph; no forced upgrades were applied. See `docs/task-1a-preflight.md`.
