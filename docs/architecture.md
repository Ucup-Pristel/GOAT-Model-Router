# GOAT architecture and decision contract

## Status

Task 1 implements configuration and control: `/goat router`, `/goat mode`, `/goat on`, `/goat off`, and `/goat status`. Task 2 adds the Manager decision layer: intent preservation, Standard/Resink planning policy, capability-tier routing, and worker prompt compilation. GOAT starts OFF.

Task 2 does **not** execute workers, send prompts to models, create sessions, audit work, retry, or escalate. `/goat on` persists an opt-in flag; it does not start orchestration.

**Task 3 Phase 3A security gate (2026-11-19):** core has a dry-run runtime contract: host/task operation intersection, explicit operation types, budgets, cancellation, recursion depth, immutable traces, and exact operation/resource binding. `TaskDecisionResult.readiness` is advisory and cannot authorize execution. OpenCode V2 `ctx.permission.assert` and permission hooks approve a connected session user, while typed plugin RPC exposes only an abort signal and no caller identity, role, authenticated principal, or signed approval. Plugin storage and RPC input are mutable by ordinary clients. No verified Project Owner authority exists in this host integration. Therefore real worker dispatch stays disabled; no approval/config field is trusted. High-impact actions (`credential`, `git_push`, `publish`, `deploy`, `destructive`) are hard-disabled, not modeled as approvals. This gate is **blocked** pending a host authority able to verify a Project Owner approval at execution boundary.

**Native permission investigation (2026-11-19):** `ctx.permission.assert` verifies OpenCode rules for a session/agent/action/resource. Host `deny` blocks; `ask` asks the connected client; saved `always` approvals create project-scoped allow rules; managed/system/Console `policies` can only tighten permissions and override lower-authority configuration. This is a usable enforcement layer for a future least-privilege worker: create a dedicated worker session, install session `deny` rules with `ctx.session.update`, and call `ctx.permission.assert` immediately before each exact low-risk tool action. It is not Project Owner authorization: SDK `PermissionEvaluation` exposes session/agent/action/resources/metadata/effect but no approval principal, identity, signature, provenance, or project-owner role. Permission evaluation hooks can set an effect, so GOAT must never use a hook result or an `allow` effect as owner proof. A host allow also cannot loosen GOAT: GOAT must retain its own deny gate before invoking host permission checks. No real worker integration is added because no trustworthy way exists to prove who answered an `ask` request or to prevent a different plugin/config authority from changing permission behavior. Isolated plugin tests assert every current RPC remains non-dispatching even when enabled config and forged approval-shaped input are supplied; native approval provenance cannot be integration-proven without a host identity API.

**Phase 3B-1 model-only investigation (2026-11-19):** Phase 3A independent re-audit passed. OpenCode V2 exposes `ctx.experimental.generate.text({ model, prompt })`, documented as one stateless model generation with no session, history, or tools. It is stronger than prompt-only tool prohibition, but its verified SDK/OpenAPI input has no abort signal, timeout, request/token/cost limit, session ID, child relationship, or cancellation handle; output is only `{ text }`. Session APIs provide interrupt/wait and tool snapshots, but no immutable tool-free child-session mode: tools are mutable plugin registrations and hooks run in plugin order. GOAT cannot prove required duration/cancellation enforcement or durable tool isolation for a worker session. Therefore no model call is wired: GOAT OFF bypass, five verbs, Standard/Resink, and L1/L2/L3 remain unchanged. Phase 3B-1 is **BLOCKED** until OpenCode exposes a cancellable, bounded, tool-free generation/session primitive, or Project Owner separately approves an isolated external sandbox with equivalent verified controls. Phase 3B-2 remains blocked.

**Phase 3B-1 approved POC (2026-11-19):** Project Owner approved one bounded synthetic model-only proof despite the above non-production limitations. Internal RPC `runModelOnly` requires exact `GOAT_MODEL_ONLY_SYNTHETIC` confirmation, GOAT ON, configured L1, and available live model. It compiles a fixed synthetic task (`Reply with exactly GOAT_MODEL_ONLY_OK.`), calls only stateless `ctx.experimental.generate.text`, returns intent/task/tier/model/result trace data, allows one request per plugin runtime, and applies a 30-second local wait budget. A local wait expiry stops waiting and blocks future requests but does **not** cancel or prove cancellation of provider work. No session, tools, shell, filesystem, network tool, subagent, approval decision, or autonomous task execution is used. Isolated-host live proof passed once with `9router/Fast-Coder`: model returned `GOAT_MODEL_ONLY_OK` in 5473 ms. The isolated server was stopped immediately after. This is POC evidence only, not production readiness; Phase 3B-2 and tool-enabled workers remain blocked.

**Task 2 audit status:** the Option A scope redesign is implemented on `dev/task-2-scope-redesign`. Natural-language scope detection is advisory and dispatch readiness is explicit. The historical FAIL that motivated this redesign remains in `docs/auditor-report-task-2.md`. The Independent Auditor returned FAIL in all three rounds; round 3 found false readiness for recognized high-risk instructions masked by a benign outcome/user plan/Resink list and for `add`/`remove`/`implement`/`fix`/`develop`/`design`/`write` release/deploy forms. The two-rework limit is exhausted, so Task 2 is not accepted and Task 3 has not started. See `docs/auditor-report-task-2-option-a.md`.

Official platform references checked 2026-11-19:

- [Plugin overview](https://opencode.ai/docs/build/plugins): server, TUI, and RPC are package parts; local plugin directories are configured in `plugins`.
- [Server plugin](https://opencode.ai/docs/build/plugins/server): `Plugin.define({ id, setup(ctx) })` from `@opencode/plugin`; `ctx.model.list()` and `ctx.provider.list()` expose live inventory; `ctx.storage` persists plugin-scoped state.
- [TUI plugin](https://opencode.ai/docs/build/plugins/cli): `Plugin.define` from `@opencode/plugin/tui`; slash commands use `context.keymap.layer` with `slash: { name, arguments: true }` and `run(input)`.
- [Plugin RPC](https://opencode.ai/docs/build/plugins/rpc): `Rpc.define` declares typed methods; the server registers handlers with `ctx.rpc.register`; the TUI calls them through `context.client.rpc(Contract)`.
- [Plugin config](https://opencode.ai/docs/plugins): local plugin paths must be directories; V2 auto-discovery uses `.opencode/plugins/`.

## Components

- **Manager:** understands the user request, preserves intent, classifies complexity/risk/context, selects a capability tier, and compiles the selected worker's execution prompt. Future owner of dispatch, bounded retry, escalation, and integration.
- **L1/L2/L3 workers:** capability tiers, not job specializations. L1 is not only research, L2 is not only coding, and L3 is not only architecture. Any tier may receive any task category within its capability. Task 2 stores and routes model assignments; execution remains unimplemented.
- **Auditor:** future independent read-only verifier. Task 2 only preserves its configured model; no AI audit runs.
- **Core decision layer:** host-independent contracts, validators, intent model, Standard/Resink policies, deterministic routing, reasoner boundary, and prompt compiler.
- **OpenCode server adapter:** RPC handlers, storage, live provider/model discovery, configuration control, and the internal `decide` RPC. It has no trusted Project Owner identity authority, so it cannot dispatch workers.
- **TUI layer:** single `/goat` slash command, argument routing, model picker, and status display. No new slash command is added in Task 2.
- **Configuration:** versioned schema with role model refs, enable flag, and mode. Invalid writes are rejected; malformed stored values fall back to safe defaults.

## Decision pipeline

Task 2 exposes `decideTask` and the read-only `decide` RPC. The pipeline is:

1. Validate configuration/request and preserve `OriginalIntent`.
2. If GOAT is OFF, return an explicit bypass with no tasks, routing, prompts, verification, reasoner calls, or model-catalog read.
3. Apply the mode policy:
   - **Standard:** preserve the user's ordered task plan, or create one task from the requested outcome. Never invoke the planner.
   - **Resink:** preserve an existing user plan verbatim; otherwise use only explicit list items (`-`, `*`, `+`, numbered) as tasks, or one task containing the full instruction when no list exists. Prose sentences, arbitrary newlines, and code blocks are not split into tasks. Pure prohibition list items are constraints/context; combined constraint/action items keep the action when separated by comma/semicolon/colon/period/`but`/`and`/`then`/`or`/`however`/`yet`/`+`/`&`, labeled forms such as `Prohibited: deploy and update parser` keep the later action, and `Not only ... but also ...` is treated as an action. A list with no actionable item and no actionable non-list prose (common planning headings with or without colons, Markdown headings/separators, `N/A`, `None`, `TBD`, label-plus-prohibition lines, and prohibitions do not count) produces a `needs_review` decision with a `no-actionable-task` finding and no tasks, rather than inventing work. Every actionable list item is preserved without a truncation cap.
4. Normalize and enforce intent traceability: every task receives all original prohibitions, constraints, acceptance criteria, permission boundaries, and the `intent:<id>` source. Missing fields are restored; malformed tasks are rejected.
5. Propagate plan-level acceptance criteria into every task, prompt, and verification contract.
6. Classify each task using deterministic complexity, risk, and context signals. A task or manager reasoner may request an explicit tier.
7. Select L1/L2/L3 from the capability policy and require the configured model for that tier.
8. Collect advisory scope findings from the original instruction and each planned task objective, so a benign outcome, user plan, or Resink list does not by itself suppress a finding for recognized risky text. Recognized direct `create`/`build`/`update` release/deploy/publish/ship/push commands are review findings; documentation and planning objects such as `Create a deployment guide` remain non-action context. The natural-language classifier never blocks a decision; it reports structured findings with `advisory` or `review` severity, and unknown phrasings may still be missed.
9. Compile an eight-section worker prompt tailored to the selected tier. Advisory scope findings are included in the prompt context.
10. Produce verification requirements for the future Auditor.
11. Derive dispatch readiness: `needs_review` when any ambiguity, high-risk task, or review-level scope finding exists; otherwise `ready`. Task 2 never dispatches and Task 3 must enforce execution permissions.

The detailed policy and contracts are documented in `docs/task-2-manager.md`.

## Contracts

Core contracts are independent of OpenCode:

- `OriginalIntent` — runtime-frozen instruction, outcome, constraints, prohibitions, user plan, acceptance criteria, ambiguities, permission boundaries.
- `TaskSpecification` — validated objective, complexity/risk/context, optional explicit tier, deliverables, criteria, prohibitions, tool restrictions, reporting format, and source requirements.
- `TaskPlan` — Resink-only ordered tasks, dependencies, and plan criteria.
- `RoutingDecision` — tier, model, reasons, uncertainty, and decision source.
- `WorkerPrompt` — eight required sections plus tier guidance.
- `VerificationRequirements` — future Auditor criteria, evidence expectations, and pass condition.
- `ScopeFinding` — advisory or review-level finding from the natural-language scope heuristic, with code, message, evidence, and optional task ID.
- `DispatchReadiness` — `ready`, `needs_review`, or `not_applicable`; ambiguity, high risk, or review-level findings produce `needs_review`.

A future model-backed Manager uses the `ManagerReasoner` interface to propose complexity/risk/context analysis and an optional explicit tier. Its output is validated, baseline uncertainty is added, and it cannot remove original constraints. Task 2 provides only the deterministic reasoner; no live model request is made. Model-generated task plans are a future integration boundary and are not accepted in Task 2.

## Capability routing

The initial policy is explainable and documented:

- L1 when complexity, risk, and context are low.
- L2 when a signal is medium and no signal requires L3.
- L3 when complexity is complex, risk is high, or context need is extensive.

Routing does not infer capability from model names, prices, or provider branding. A task or manager reasoner may request an explicit tier. Missing tier models throw. The RPC checks the live model catalog; the core API checks supplied availability, including an empty inventory, and records uncertainty when availability is not supplied. Capability metadata is never fabricated and reasoner-supplied analysis cannot erase baseline uncertainty.

## Safeguards

- OFF by default. OFF is derived from persisted config; Task 2 returns a bypass before planning, routing, prompt generation, reasoner calls, or model-catalog reads.
- User intent is runtime-frozen. Tasks are normalized to retain constraints, prohibitions, acceptance criteria, permission boundaries, and intent traceability; the prompt compiler checks them again.
- Plan-level acceptance criteria propagate to tasks, prompts, and verification.
- Natural-language deploy/publish/release/ship/push detection is **advisory**. It produces `scopeFindings` and never throws for a phrase it does not recognize or misclassifies. Findings are collected from the original instruction as well as task objectives; recognized direct `create`/`build`/`update` release/deploy/publish/ship/push commands are review findings, while documentation/planning work, polite/status forms, code paths, and feature-delivery phrases are expected to produce no action finding. The heuristic is not a complete classifier, so a missed phrasing can still produce `ready`; Task 3 must enforce permissions at execution time.
- Within a decision result, ambiguity, high-risk tasks, and review-level scope findings set `readiness: "needs_review"` with explicit `reviewReasons`; `"ready"` is accepted only when none are present. Deterministic contract validation still rejects malformed configuration, requests, intent, tasks, plans, decisions, prompts, and findings.
- Runtime permission and scope enforcement is deferred to Task 3. Task 2 has no dispatcher to enforce it. Task 3 Phase 3A has dry-run enforcement contracts only; real dispatch is disabled because OpenCode V2 plugin/RPC APIs do not expose a verified Project Owner identity or approval credential.
- No worker execution, session creation, model prompt, tool execution, deployment, publishing, or Git push exists in Task 2.
- No recursive GOAT invocation. Worker prompts explicitly prohibit recursion and permission escalation.
- Permissions: future workers inherit OpenCode permissions; no privilege escalation. Auditor will be read-only and deny write/tool execution.
- Retry cap: one retry per task by default in the future orchestration; Task 2 has no retry.
- Budget: no model calls in Task 2, so no token usage. Per-task budgets remain a Task 3 requirement.
- Errors preserve original task context. Missing models, malformed contracts, and invalid requests are explicit errors, never silent fallbacks.
- Secrets: never place credentials in config values, logs, test fixtures, or findings.

## Lifecycle

`queued -> classifying -> delegated -> auditing -> completed` is the future success path. `delegated` or `auditing` may enter `retrying`, `escalated`, `failed`, or `cancelled`. `retrying` may return to `delegated` or end via escalation/failure/cancellation. `escalated` may return to `delegated` after Manager approval, or end failed/cancelled. `completed`, `failed`, and `cancelled` are terminal. Invalid transitions are rejected by the core lifecycle contract.

## Roadmap

1. **Task 1 (completed, audited PASS):** configuration contracts, role model selection, Standard/Resink mode flag, persistent ON/OFF, single `/goat` command, isolated host verification.
2. **Task 2 (Option A scope redesign implemented; independent audit blocked, not accepted):** Manager intent/task contracts, Standard/Resink decision policy, capability routing, worker prompt compiler, advisory scope findings, dispatch readiness, internal decision RPC, deterministic tests. The historical FAIL is preserved in `docs/auditor-report-task-2.md`; implementation self-verification is in `docs/scope-redesign-verification.md`. An independent verdict is still required.
3. **Task 3:** Phase 3A dry-run runtime contracts and adversarial tests implemented. Phase 3B bounded single-worker execution is blocked until a verified host-owned Project Owner approval authority exists; permission prompts/config flags/RPC inputs are not that authority.
4. **Task 4:** multi-worker routing, release packaging, version compatibility, and production verification.

No next task starts without Project Owner approval.

## Task 1 implementation note

OpenCode V2 server commands and TUI slash commands are separate registries. GOAT `/goat` is TUI-owned and calls typed server RPC. Do not duplicate it as a server command. RPC actions read/write `ctx.storage`; orchestration stays OFF by default and remains unimplemented beyond the Task 2 decision layer.

RPC output envelopes are part of the contract: `getConfig` and `setConfig` return `{ config: GoatConfig }`, not a bare config. The server handler and shared `Rpc.define` schema must change together. A regression test validates handler output against the declared JSON schema.

Task 1 command protocol: slash input maps to exactly `router`, `mode`, `on`, `off`, and `status`. `/goat router` opens a cancellable, provider/model-qualified picker; `/goat mode` chooses Standard/Resink; ON/OFF persist only the flag; status uses provider-qualified IDs and reports current model availability. Settings live in plugin-scoped server storage and are isolated per OpenCode plugin installation/location, not a global cross-project config.
