# GOAT Model Router

Open-source, model-agnostic orchestration plugin for OpenCode V2. Task 1 provides the configuration/control plane. Task 2 adds the **Manager decision layer**: intent preservation, Standard/Resink planning policy, capability-tier routing, and worker prompt compilation.

On a conversation-enabled local mock host, the primary Build agent can run a verified text task from an ordinary prompt after `/goat on`. It uses the same dispatcher as the explicit `dispatchText` RPC, with a deny-all Worker, a separate deny-all Auditor and at most one rework. See [activation and conversation evidence](docs/task-3-conversation.md) and the [RPC baseline](docs/task-3-plugin-integration.md).

For the first owner-operated live coding test, see the [private Linux coding profile and exact launch instructions](docs/task-3-live-coding.md). It uses the configured Manager, Worker and Auditor, a disposable single-file workspace, and kernel-isolated Python function checks. Development verification used only the local mock.

**Manager status:** the [historical Option A audit](docs/auditor-report-task-2-option-a.md) returned FAIL in all three rounds. The subsequent targeted repair on the orchestration branch addresses the two confirmed round-3 defects: original instruction risk masked by planning, and direct release/deploy actions mistaken for documentation. See the [scoped verification and Task 3 handoff](docs/manager-repair-and-task-3-handoff.md). Advisory readiness does not authorize worker dispatch.

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
- OpenCode V2 `2.3.2` (regression baseline), `2.4.1`, or `2.4.2`. The development SDK remains pinned to `2.3.2`. See the [verified host matrix](docs/task-3-opencode-compat.md).

## Local checks

```sh
npm install
npm run check
npm test
```

To reproduce the Manager re-audit and native host probes with a local mock provider,
run `npm run audit:milestone` with OpenCode 2.3.2. See the [original reproductions and host setup](docs/manager-and-host-reaudit.md)
and the [post-repair results and remaining skips](docs/manager-repair-and-task-3-handoff.md).

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
- Conversation dispatch requires the provisioned isolated profile as well as `/goat on`. The RPC-only profile and ordinary installations do not intercept prompts. Production dispatch is disabled.
- Standard and Resink retain their Manager policies. The isolated RPC executes only a single ready task with a supported verifier.
- Natural-language scope and heading heuristics are advisory. They can produce false positives or miss a phrasing; `scopeFindings` is not a security boundary.
- `readiness: "needs_review"` prevents the decision from being declared dispatch-ready, but Task 2 never dispatches; Task 3 must enforce permissions and scope at execution time.
- The deterministic routing policy is an initial explainable baseline; live model-backed Manager reasoning is a future integration boundary.
- Model assignments are validated against the live provider inventory when saved; status flags models that later become unavailable.
- Configuration storage is scoped to the plugin installation/location, not synchronized across projects.
- 24 moderate dependency advisories remain in the pinned SDK graph; no forced upgrades were applied. See `docs/task-1a-preflight.md`.
