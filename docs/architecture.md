# Architecture

GOAT has two packages. `@goatmr/core` is a TypeScript/Node ESM library with no OpenCode dependency. `@goatmr/opencode` is its native host adapter. The core decides what work is ready; the adapter controls access to models, tools and files. OpenCode is the only production adapter in this beta.

## Core and host responsibilities

| Portable core | OpenCode adapter |
|---|---|
| Preserves the instruction, routes capability tiers and validates the task graph. | Discovers workspace files, checks native permissions and binds each child session to its model and tools. |
| Schedules ready Workers, integrates in-memory snapshots and shares a `RoleBudget`. | Runs and interrupts child sessions, accounts for requests and materializes staged files. |
| Matches audit verdicts to evidence and selects tasks for bounded rework. | Runs protected checks, requests apply permission, detects conflicts, writes verified files and returns a receipt. |

## Execution host contract

`decideTask` produces a plan; it cannot grant permission. [`executePlan`](../packages/core/src/execution.ts) runs a ready plan through an `ExecutionHost` bound to authorized work. Before a measured operation, the host calls `reserve()` to consume one unit of the shared request budget. Observed token usage is not a billing cap.

`runWorker` receives a model, tier, prompt, attempt and scope. It returns only after integrating accepted edits, so successors can read them. `audit` receives an evidence packet and a separate model; the host enforces read-only access. The [in-memory host test](../packages/core/test/portability.test.ts) exercises this contract without starting OpenCode or contacting a provider.

If the host cannot enforce authorization, tool restrictions, accounting or cancellation, a null host yields `unsupported_execution`. Missing required model or tool capabilities also stop dispatch. If a task requires a verifier and none is available, the result is `unsupported_verification`.

## OpenCode integration

The adapter exposes [server, TUI and RPC parts](https://opencode.ai/docs/build/plugins) through one npm package. The TUI calls typed server RPCs for model discovery and configuration. `getConfig` and `setConfig` return `{ config: GoatConfig }`.

Fresh plugin storage defaults to OFF and Standard. Enabling GOAT does not start a task. On OpenCode 2.4.2, role selections, mode and activation persist across workspaces that load GOAT against the same host database. Provider authentication, model sessions and native permissions stay with OpenCode.

See [orchestration](orchestration.md) for planning and scheduling, and [verification](verification.md) for the boundary between a staged result and a checkout write.
