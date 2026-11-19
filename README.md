# GOAT Model Router

Open-source, model-agnostic orchestration plugin for OpenCode V2. Task 1 provides the configuration/control plane. Task 2 adds the **Manager decision layer**: intent preservation, Standard/Resink planning policy, capability-tier routing, and worker prompt compilation.

Runtime worker execution, AI auditing, retries, and escalation are **not implemented yet**. GOAT never claims end-to-end orchestration.

**Task 2 status:** implementation and tests are complete, but the independent Auditor's verdict is **FAIL**. Task 2 is not accepted. See `docs/auditor-report-task-2.md` for blocking findings. Task 3 has not started.

GOAT defaults **OFF**. While OFF, the plugin exposes only the `/goat` TUI command and its RPC handlers; it does not run the decision pipeline, intercept normal prompts, create sessions, or call models.

## Commands

Exactly one public slash command is registered: `/goat`.

| Command | Behavior |
|---|---|
| `/goat router` | Opens a provider/model picker for Manager, L1, L2, L3, and Auditor. Manager can inherit the current session model. |
| `/goat mode` | Selects Standard or Resink. Standard disables Task Planner; Resink enables structured planning when a decision is requested. |
| `/goat on` | Persists `enabled: true`. Does not start orchestration or execute a worker. |
| `/goat off` | Persists `enabled: false`. Native OpenCode behavior remains unchanged. |
| `/goat status` | Reports persisted state, mode, role assignments, and model availability. |

OpenCode V2 TUI slash commands and server commands are separate. The TUI command calls a typed server RPC contract (`Rpc.define`) over `context.client.rpc(Goat)`; no duplicate server `/goat` command is registered. Settings are stored in plugin-scoped server storage, not global OpenCode configuration.

Task 2 adds a read-only internal RPC, `decide`, for decision-layer and plugin compatibility tests. It is not a slash command and does not execute workers.

## Manager decision layer

- `OriginalIntent` preserves the original instruction exactly, plus constraints, prohibitions, user plan, acceptance criteria, ambiguities, and permission boundaries.
- **Standard** never invokes the Task Planner. It preserves a user-supplied ordered plan or creates one task from the requested outcome.
- **Resink** may create an ordered `TaskPlan` with dependencies when no user plan is supplied. An existing user plan is respected.
- Routing selects L1, L2, or L3 from complexity, risk, and context signals, and accepts an explicit tier from the task, decision request, or manager reasoner. These are capability tiers, not job specializations.
- Worker prompts contain objective, context, scope, deliverables, acceptance criteria, prohibitions, tool/permission restrictions, and reporting format.
- Missing or unavailable configured models are explicit errors; there is no silent fallback.
- The `ManagerReasoner` interface defines the future model-backed analysis boundary, including an optional explicit tier. Task 2 uses deterministic planning and makes no model requests; model-generated plans are not accepted yet.

See `docs/task-2-manager.md` for contracts, policy assumptions, and limitations.

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

- `packages/core`: host-independent lifecycle, configuration contracts, and the Task 2 Manager decision layer (`src/manager`).
- `packages/opencode`: server plugin (RPC handlers + storage) and TUI plugin (single `/goat` command), with shared RPC contract.
- `docs/architecture.md`: architecture, contracts, policies, safeguards, and roadmap.
- `docs/task-2-manager.md`: Task 2 decision contracts, routing policy, prompt compiler, and integration boundary.
- `docs/task-1a-preflight.md`: Task 1 host integration evidence, RPC root-cause fix, and dependency audit.
- `docs/auditor-report.md`: Task 1 independent Auditor verdicts.
- `docs/auditor-report-task-2.md`: Task 2 independent Auditor verdict (FAIL; Task 2 not accepted).

## Current limitations

- Task 2 does not route work to a running worker, create sessions, or invoke worker/auditor models.
- `/goat on` is an opt-in flag only; orchestration remains unimplemented.
- Standard and Resink differ only in Manager Task Planner policy. Neither executes tasks.
- The deterministic routing policy is an initial explainable baseline; live model-backed Manager reasoning is a future integration boundary.
- Model assignments are validated against the live provider inventory when saved; status flags models that later become unavailable.
- Configuration storage is scoped to the plugin installation/location, not synchronized across projects.
- 24 moderate dependency advisories remain in the pinned SDK graph; no forced upgrades were applied. See `docs/task-1a-preflight.md`.
