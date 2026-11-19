# GOAT architecture and Task 0 contract

## Status and verified platform contract

Task 1 implements configuration and control only: `/goat router`, `/goat mode`, `/goat on`, `/goat off`, and `/goat status`. GOAT starts OFF. No worker execution, task planner, automatic classification, AI audit, retry, or escalation exists yet. `/goat on` persists an opt-in flag; it does not start orchestration.

Official docs checked 2026-11-19:

- [Plugin overview](https://opencode.ai/docs/build/plugins): server, TUI, and RPC are package parts; local plugin directories are configured in `plugins`.
- [Server plugin](https://opencode.ai/docs/build/plugins/server): `Plugin.define({ id, setup(ctx) })` from `@opencode/plugin`; `ctx.model.list()` and `ctx.provider.list()` expose live inventory; `ctx.storage` persists plugin-scoped state.
- [TUI plugin](https://opencode.ai/docs/build/plugins/cli): `Plugin.define` from `@opencode/plugin/tui`; slash commands use `context.keymap.layer` with `slash: { name, arguments: true }` and `run(input)`.
- [Plugin RPC](https://opencode.ai/docs/build/plugins/rpc): `Rpc.define` declares typed methods; the server registers handlers with `ctx.rpc.register`; the TUI calls them through `context.client.rpc(Contract)`.
- [Plugin config](https://opencode.ai/docs/plugins): local plugin paths must be directories; V2 auto-discovery uses `.opencode/plugins/`.

GOAT uses a **TUI-owned** `/goat` command that calls typed server RPC. It deliberately does not register a second server-side `/goat` prompt command. The server side owns configuration validation, live model inventory, and persistence. This avoids duplicate command surfaces and keeps slash interaction in the TUI.

## Components

- **Manager:** current primary agent; future owner of routing, bounded retries, escalations, and integration. In Task 1 its model may inherit the session model or be configured explicitly.
- **L1/L2/L3 workers:** capability tiers, not fixed job specializations. Task 1 only stores model assignments; execution is not implemented.
- **Auditor:** future independent read-only verifier with structured findings. Task 1 only stores its model; no AI auditing runs.
- **Core:** host-independent lifecycle, configuration defaults, validation, and model status contracts.
- **OpenCode server adapter:** RPC handlers, storage, live provider/model discovery, and CLI-subcommand behavior.
- **TUI layer:** single `/goat` slash command, argument routing, model picker, and status display.
- **Configuration:** versioned schema with exact role model refs, enable flag, and mode. Invalid top-level values are rejected; malformed stored values fall back to safe defaults.

## Lifecycle and transitions

`queued -> classifying -> delegated -> auditing -> completed` is success path. `delegated` or `auditing` may enter `retrying`, `escalated`, `failed`, or `cancelled`. `retrying` may return to `delegated` or end via escalation/failure/cancellation. `escalated` may return to `delegated` after Manager approval, or end failed/cancelled. `queued` can be cancelled; `classifying` can fail/cancel. `completed`, `failed`, and `cancelled` are terminal. Invalid transitions must be rejected.

Auditor result contract for future implementation: `{ outcome: "pass" | "fail", findings: [{ severity, file?, line?, message, recommendation }] }`. Auditor cannot invoke edits or choose retries/escalation.

## Safeguards

- OFF by default. Task 1 OFF behavior is implemented: the plugin registers only the TUI command and RPC handlers; it does not create sessions, call models, or intercept normal prompts.
- Retry cap: one retry per task by default; no automatic unbounded retry. Manager can escalate or stop. Future orchestration only.
- Budget: per-task invocation/token/cost ceiling; reserve budget for audit; stop before overrun. Future orchestration only.
- Recursion: mark GOAT-created child sessions with private metadata and refuse GOAT routing when marker is present; cap child depth at one initially. Future orchestration only.
- Permissions: workers inherit OpenCode permissions; no privilege escalation. Auditor read-only and deny write/tool execution. Ask before any future side effect not already allowed.
- Errors: preserve original task context; failed worker/auditor goes to Manager, never silently reports pass. Task 1 never reports a fake enabled/orchestrated state.
- Secrets: never place credentials in config values, logs, test fixtures, or findings.

## Roadmap

1. **Task 1 (implemented, pending Project Owner review):** configuration contracts, role model selection using live provider inventory, Standard/Resink mode, persistent ON/OFF, single `/goat` command, isolated host verification.
2. **Task 2:** Manager classification and bounded single-worker delegation, permission inheritance, budgets, recursion marker, deterministic tests.
3. **Task 3:** independent read-only Auditor with structured findings, controlled rework/escalation, adversarial tests.
4. **Task 4:** multi-worker L1/L2/L3 routing, release packaging/version compatibility, and production verification.

No next task starts without Project Owner approval.

## Task 1 implementation note

OpenCode V2 server commands and TUI slash commands are separate registries. GOAT `/goat` is TUI-owned and calls typed server RPC. Do not duplicate it as a server command: that would produce a prompt command with different behavior and risks duplicate `/goat` entries. RPC actions read/write `ctx.storage`; orchestration stays OFF by default and remains unimplemented. See `task-1a-preflight.md` for real-host evidence and limitations.

RPC output envelopes are part of the contract: `getConfig` and `setConfig` return `{ config: GoatConfig }`, not a bare config. The server handler and the shared `Rpc.define` schema must change together. A regression test validates handler output against the declared JSON schema.

Task 1 command protocol: slash input maps to exactly `router`, `mode`, `on`, `off`, and `status`. `/goat router` opens a cancellable, provider/model-qualified picker; `/goat mode` chooses Standard/Resink; ON/OFF persist only the flag; status uses provider-qualified IDs and reports current model availability. Settings live in plugin-scoped server storage. They are isolated per OpenCode plugin installation/location, not a global cross-project config.
