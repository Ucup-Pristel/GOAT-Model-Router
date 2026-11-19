# GOAT Model Router

Open-source, model-agnostic orchestration plugin for OpenCode V2. Task 1 provides the configuration/control plane. Task 2 adds the **Manager decision layer**: intent preservation, Standard/Resink planning policy, capability-tier routing, and worker prompt compilation.

Runtime worker execution, AI auditing, retries, and escalation are **not implemented yet**. GOAT never claims end-to-end orchestration.

**Task 2 status:** the Option A scope redesign is implemented on `dev/task-2-scope-redesign`: natural-language scope classification is now advisory (`scopeFindings`), while deterministic contract validation remains hard. Runtime permission enforcement is deferred to Task 3. The Independent Auditor returned **FAIL** in all three rounds. Round 3 found remaining false readiness: recognized high-risk original instructions (`Delete the production database`, `Update production credentials`) masked by a benign outcome/user plan/Resink list were not risk-analyzed, and `add`/`remove`/`implement`/`fix`/`develop`/`design`/`write` release/deploy forms still bypassed the scan. The two-rework limit is exhausted, so implementation stopped. Task 2 is **not accepted**, and Task 3 has not started. See `docs/auditor-report-task-2-option-a.md`.

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
- Natural-language deploy/publish/release/ship/push detection is advisory only and is reported as structured `scopeFindings`; it never blocks a decision. The scan covers both the original instruction and each planned task objective, so a benign outcome, user plan, or Resink list does not by itself suppress a finding for recognized risky original text. Recognized direct `create`/`build`/`update` release, deploy, publish, ship, or push commands produce review findings. Runtime execution enforcement is a Task 3 responsibility.
- Within a decision result, `readiness: "needs_review"` is required for intent ambiguity, high-risk tasks, or review-level scope findings; `"ready"` is accepted only when none of those are present. Detection remains heuristic: see the limitation below.
- Missing or unavailable configured models are explicit errors; there is no silent fallback.
- The `ManagerReasoner` interface defines the future model-backed analysis boundary, including an optional explicit tier. Task 2 uses deterministic planning and makes no model requests; model-generated plans are not accepted yet.

See `docs/task-2-manager.md` for contracts, policy assumptions, and limitations.

## Requirements

- Node.js 22.19+ (verified with 22.22.1)
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
- `docs/auditor-report-task-2.md`: historical Task 2 Auditor verdict (FAIL) that motivated the Option A redesign.
- `docs/auditor-report-task-2-option-a.md`: independent Auditor verdicts for the Option A redesign, including round 1 FAIL and the re-audit.
- `docs/scope-redesign-verification.md`: implementation self-verification for Option A (not a substitute for an independent audit).

## Current limitations

- Task 2 does not route work to a running worker, create sessions, or invoke worker/auditor models.
- `/goat on` is an opt-in flag only; orchestration remains unimplemented.
- Standard and Resink differ only in Manager Task Planner policy. Neither executes tasks.
- Natural-language scope and heading heuristics are advisory. They can produce false positives or miss a phrasing; `scopeFindings` is not a security boundary.
- `readiness: "needs_review"` prevents the decision from being declared dispatch-ready, but Task 2 never dispatches; Task 3 must enforce permissions and scope at execution time.
- The deterministic routing policy is an initial explainable baseline; live model-backed Manager reasoning is a future integration boundary.
- Model assignments are validated against the live provider inventory when saved; status flags models that later become unavailable.
- Configuration storage is scoped to the plugin installation/location, not synchronized across projects.
- 24 moderate dependency advisories remain in the pinned SDK graph; no forced upgrades were applied. See `docs/task-1a-preflight.md`.
