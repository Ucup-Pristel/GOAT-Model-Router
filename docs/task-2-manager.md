# Task 2 — Manager decision layer

Task 2 implements the Manager's decision foundation only. It does not execute workers, call models, audit work, retry, or escalate. The five existing `/goat` commands remain the only user-facing slash surface; mode dialog and mode-response wording were clarified, with no new command or verb.

## Scope

Implemented in `packages/core/src/manager`:

- runtime-frozen `OriginalIntent` with constraints, prohibitions, user plan, acceptance criteria, ambiguities, and permission boundaries;
- validated `TaskSpecification`, `TaskPlan`, `RoutingDecision`, `WorkerPrompt`, and `VerificationRequirements` contracts;
- Standard and Resink planning policies;
- explainable capability-tier routing;
- worker prompt compilation for L1/L2/L3;
- an OFF bypass before planning, routing, or prompt generation;
- an internal read-only `decide` RPC for plugin compatibility and future Task 3 integration.

No worker session is created. No prompt is sent to a model. No file, tool, deployment, or Git operation is performed.

## Contracts

All contracts live in `packages/core/src/manager/contracts.ts` and are independent of OpenCode APIs. Runtime validators reject malformed writes and reasoner output.

| Contract | Purpose |
|---|---|
| `OriginalIntent` | Immutable source of truth. `instruction` is preserved exactly; arrays capture outcome, constraints, prohibitions, user plan, acceptance criteria, ambiguities, and permission boundaries. |
| `TaskSpecification` | One validated unit of work with an objective, complexity/risk/context signals, optional explicit tier, deliverables, criteria, prohibitions, tool restrictions, reporting format, and source requirements. |
| `TaskPlan` | Resink-only ordered task list with dependencies and plan-level acceptance criteria. Plan criteria are propagated to every task, prompt, and verification contract. |
| `RoutingDecision` | Selected capability tier, configured model ref, deterministic reasons, uncertainty, and decision source. An explicit tier can come from the task or a manager reasoner. |
| `WorkerPrompt` | Eight-section prompt plus tier guidance and rendered text. |
| `VerificationRequirements` | Future Auditor criteria, expected evidence, and `all-criteria` pass condition. |

`OriginalIntent.instruction` is not rewritten or summarized in storage. Every task carries `intent:<id>` in `sourceRequirements`. The pipeline normalizes every task to include all original constraints, prohibitions, acceptance criteria, and permission boundaries, then rejects any task that still drops one or its intent trace. The prompt compiler performs the same preservation check for direct callers.

## Mode policy

### Standard

Standard never invokes the planner. If the user supplies an ordered task plan, the pipeline creates exactly one `TaskSpecification` per supplied item in the same order and does not add, replace, or reorder tasks. If no user plan exists, it creates one task from the requested outcome. Standard keeps `plan: null`; task order is preserved, and no dependency records or new dependencies are invented.

### Resink

Resink may create a `TaskPlan`. If the user supplied a plan, Resink uses it unchanged, does not filter, decompose, or add dependencies, and preserves even prohibition-like plan items because the user's plan is authoritative. Without a user plan, the deterministic planner uses only explicit list items (`-`, `*`, `+`, or numbered lines outside fenced code blocks) as tasks. If there is no explicit list, it creates one task containing the full instruction; prose sentences, arbitrary newlines, and code blocks are not split into tasks.

Explicit list items that are pure prohibitions (`Do not ...`, `Don't ...`, `Never ...`, `Cannot ...`, `Under no circumstances ...`, `Prohibited ...`, `Forbidden ...`, `Not ...`, `Refrain from ...`, `Avoid ...`, `Without ...`, `No ...`) are treated as constraints/context, not tasks. Combined constraint/action items keep the action as the task objective when the constraint and action are separated by comma, semicolon, colon, period, `but`, `and`, `then`, `or`, `however`, `yet`, `+`, or `&`; examples include `Without network access: update the parser`, `Do not deploy, but update the parser`, `Do not deploy and update parser`, `Do not deploy+update parser`, and `Prohibited: deploy and update parser`. `Not only ... but also ...` is treated as an action, not a prohibition. The constraint remains in the original instruction context. If the list has no actionable item, and non-list prose contains no actionable item either, the plan is rejected with `No actionable task found` instead of inventing work. Heading detection covers common planning labels (`Deliverables`, `Goals`, `Approach`, `Implementation`, `Plan`, `Design`, `Architecture`, `Risks`, `Dependencies`, `Challenges`, `Open questions`, `Success criteria`, `Assumptions`, `Non-goals`, `Out of scope`, `Implementation details`, `Notes and constraints`, `Next steps`, `Risks and mitigations`, `Open issues`, `Action items`, `Follow-ups`, `Decisions`, `Testing strategy`, `Test plan`, `Validation`, `Rollout`, `Migration plan`, `Known issues`, `Open risks`, `Next actions`, `Action plan`, `Success metrics`, `Key risks`, `Questions`, `Mitigations`, `Risks/mitigations`, `Assumptions and risks`, `Notes and risks`, `Open questions and risks`, `Review notes`, `Testing notes`, `Known problems`, `Open problems`, `Key questions`, `Unknowns`, `Constraints and assumptions`, `Risks and assumptions`, `Notes and assumptions`, `Questions and answers`, `Action items and owners`, `Follow-up items`, `Decisions and open questions`, `Test results`, `Testing summary`, `Validation results`, `Rollout plan`, `Migration steps`, and related labels), with or without colons, Markdown headings/separators, `N/A`, `None`, `TBD`, and label-plus-prohibition lines such as `Constraints: Do not deploy`; these do not count as actionable unless the same line contains a later action. Every actionable list item is preserved without a truncation cap; non-list prose and prohibition items remain in the original instruction context included in every worker prompt. Generated plans get sequential dependencies.

## Routing policy

Initial policy is deterministic and explainable:

| Signal | Low | Medium | High |
|---|---|---|---|
| Complexity | short, single-purpose | implementation/multiple steps | broad scope, multiple markers, or high impact |
| Risk | informational or read-only | changes behavior/files | deploy, publish, delete, security, credentials, production, migration, database, auth |
| Context | locally scoped | moderate context | repository/codebase/multi-file context |

Tier mapping:

- **L1** when all signals are low.
- **L2** when any signal is medium and none requires L3.
- **L3** when complexity is complex, risk is high, or context need is extensive.

These are capability tiers, not job roles. The same tier can receive any task category. Routing never uses model names, prices, or provider branding. The configured model for the selected tier is required; missing models throw. The RPC always checks the live model catalog. In the core API, an empty or non-matching supplied inventory throws; when availability is omitted, the decision records that uncertainty.

A task, decision request, or manager reasoner may request an explicit L1/L2/L3 tier. The decision records that explicit request in its reasons. Out-of-scope segments that begin with deploy/publish/release/ship/push actions are rejected unless they are documentation/planning or feature-delivery phrases. The detector covers common imperative, one-word/gerund (`Push`, `Pushing`, `Release`, `Releasing`, `Ship`, `Shipping`), noun (`Deployment of ...`), article/object forms (`Release the package`, `Ship the build`, `Push origin main`, `Push my changes`, `Push tag`, `Push upstream`, `Push into main`, `Push a PR`), modifier combinations (`Push a new tag`, `Push the latest commit`, `Push the new branch`), `run/execute/perform deployment`, `run npm publish`, `npm publish`, `git push`, `release/ship to production`, embedded second-sentence forms, and compound clauses joined by punctuation, `and`/`then`/`also`/`plus`/`but`/`or`/`however`/`yet`, and colon/dash/pipe/arrow/no-space connectors. No-space connectors are split when an allow/planning phrase is followed by an action, including path arguments such as `Deployment guide+deploy src/config`, while pure path tasks (`Update src/deploy/config.ts`) remain intact. It allows documentation/planning phrases such as `Deployment guide`, `Deploying our docs`, `Deploy docs`, `Publish the new docs`, `Release the latest notes`, `Ship documentation`, plus `Push the boundary`, `Push notification`, `Push API`, `Push UI`, `Push service`, `Push updates`, `Push feature flags`, `Ship the feature`, `Release the feature`, `Release our features`, `Update deploy script`, and `production deployment`. It also allows normal work that starts with planning/read/update verbs, including polite prefixes (`Please review deployment`, `Could you kindly review deployment`, `Let us review deployment`), and noun/bug-report forms (`The deployment is broken`, `The deployment has errors`, `The deploy script is broken`, `The push service is down`, `The release notes need updating`). It rejects actual feature/bug deployment commands such as `Deploy the feature`, `Deploy the bug fix`, `Publish the bug fix`, `Release the bug fix`, and `Ship the bug fix`. This is a conservative heuristic, not a general natural-language classifier.

Every decision includes human-readable reasons and uncertainty. Model capability metadata is not invented; the policy records that capability metadata is unavailable. A manager reasoner cannot erase that baseline uncertainty or omit rationale; missing rationale is recorded explicitly.

## Manager reasoning boundary

Task 2 defines a `ManagerReasoner` interface with an optional `analyzeTask` method. The default implementation is deterministic. A future verified agent integration may supply model-backed analysis, including an explicit tier, but Task 2 never calls a model and does not accept model-generated task plans.

- Deterministic: validation, OFF bypass, user-plan preservation, Resink planning, tier policy, availability checks, intent trace enforcement, prompt assembly, and out-of-scope rejection.
- Future model-backed: richer complexity/risk/context analysis and an explicit tier proposal.
- Unchanged guardrail: reasoner output is validated; baseline capability uncertainty and explicit rationale requirements are added even if the reasoner omits them.

A model-backed Resink planner is a future integration boundary; Task 2 does not claim it works. This avoids accepting arbitrary model-generated objectives as tasks before verification is implemented.

## Worker prompt compiler

Every prompt contains:

1. original task objective;
2. relevant context and confirmed facts;
3. exact assigned scope;
4. required deliverables;
5. acceptance criteria;
6. explicit prohibitions;
7. tool and permission restrictions;
8. expected reporting format.

Tier guidance changes depth and rigor: L1 favors a small verifiable change, L2 balances thoroughness and tradeoffs, and L3 addresses cross-cutting risks and edge cases. No tier is specialized by task category. The compiler never fabricates repository facts, tool results, or test outcomes; it states that only supplied information is assumed.

## Safety

- GOAT OFF is derived from persisted config, not a caller flag. It returns `status: "bypassed"` with no tasks, decisions, prompts, verification, reasoner calls, or model-catalog read. Intent input is normalized only to report the bypass; no classification, planning, routing, or prompt generation runs.
- Invalid requests, configuration, contracts, modes, and reasoner output are rejected.
- Missing or unavailable tier models throw explicit errors; there is no silent fallback.
- Permission boundaries are merged into every task's tool restrictions and checked again by the prompt compiler. The prompt forbids permission escalation, recursive GOAT invocation, deployment, publishing, and Git push.
- Common deploy/publish/release/ship/push command phrasings are rejected by a documented conservative heuristic; this is not claimed as a complete natural-language classifier. Actual execution remains impossible because Task 2 never executes tools.
- No model request, session creation, worker execution, or tool execution exists in Task 2.

## Internal RPC

`Goat.methods.decide` accepts `{ request }` and returns `{ status, reason?, result }`. It reads persisted GOAT config and the live model catalog only when GOAT is ON; callers cannot supply a fabricated inventory. It is not a slash command and does not change the five `/goat` commands. `result` contains the validated intent, tasks, optional Resink plan, routing decisions, worker prompts, and verification requirements.

## Tests

`packages/core/test/manager.test.ts` covers simple/L2/complex classification, explicit direct L3 and invalid tier rejection, Standard user-plan preservation, Resink explicit-list planning and user-plan respect, code-block/prose non-splitting, `-`/`*`/`+`/numbered list items, all-prohibition list rejection including colon/no-colon/Markdown headings (`Deliverables`, `Goals`, `Plan`, `Design`, `Architecture`, `Risks`, `Dependencies`, `Challenges`, `Open questions`, `Success criteria`, `Assumptions`, `Non-goals`, `Out of scope`, `Implementation details`, `Notes and constraints`, `Next steps`, `Risks and mitigations`, `Open issues`, `Action items`, `Follow-ups`, `Decisions`, `Testing strategy`, `Test plan`, `Validation`, `Rollout`, `Migration plan`, `Known problems`, `Open problems`, `Key questions`, `Unknowns`, `Constraints and assumptions`, `Risks and assumptions`, `Notes and assumptions`, `Questions and answers`, `Action items and owners`, `Follow-up items`, `Decisions and open questions`, `Test results`, `Testing summary`, `Validation results`, `Rollout plan`, `Migration steps`, etc.), separators, `N/A`/`None`, mixed list prohibition filtering, combined constraint/action items using comma/semicolon/colon/period/`but`/`and`/`then`/`or`/`however`/`yet`/`+`/`&`, label-plus-action lines, labeled combined actions (`Prohibited: deploy, update parser`), same-line prohibition-plus-action prose, `Not only ... but also ...`, expanded prohibition forms (curly apostrophe, `Cannot`, `Under no circumstances`, `Prohibited`, `Forbidden`, `Not`, `Refrain`), intent/prohibition/permission preservation, plan-level criteria propagation, all three prompt tiers, prompt compiler permission-only/out-of-scope/tier-mismatch rejection, ambiguity reporting, missing/unavailable models, persisted-OFF bypass, invalid contracts/configuration, unknown request fields, reasoner uncertainty enforcement, one-word/gerund/noun/article/object/embedded/compound out-of-scope variants, additional push targets/modifiers, no-space/path connector variants, polite/noun normal requests, normal code/docs/ops tasks and paths, feature/bug-fix deploy/publish commands, and documentation/planning false-positive controls (determiners, possessives, plural, gerund docs forms), word-boundary high-risk detection, runtime freezing, and normalized intent IDs.

`packages/opencode/test/decision.test.ts` covers OFF bypass without catalog reads, Standard planning with live inventory, explicit tier selection, Resink planning with live inventory, schema validation, and malformed decision requests including caller-supplied inventory rejection.

## Local verification

- Node `22.23.5`; `npm run check` clean.
- `npm test`: **41/41 pass**, including all Task 1 regression tests.
- `npm pack --dry-run --workspace @goat/opencode`: 4 files, 3.8 kB, no tarball written.
- `npm audit --json`: **24 moderate, 0 high, 0 critical**; no forced upgrades.
- Source scan: one slash `/goat`, no server command hook, no session execution, no model generation, no child-process execution.
- Git baseline commit `dde15b6` contains Task 1 before Task 2 changes; `opencode.json` remains untracked and unmodified.

## Host smoke evidence

A fresh isolated OpenCode V2 host was used after the Task 2 implementation: `HOME=/tmp/opencode/goat-2m-home`, `XDG_CONFIG_HOME=/tmp/opencode/goat-2m-xdg`, project `/tmp/opencode/goat-2m-test`, new SQLite database, copied plugin directory, Node 22.23.5, OpenCode 2.3.2. Captures: `/tmp/opencode/goat-2m-host.raw` and `/tmp/opencode/goat-2m-*.txt`.

- Plugin loaded from the isolated entrypoint with no loader error.
- `/goat status` reported OFF, Standard, Manager inherit, all tiers unconfigured.
- `/goat on` reported ON saved and explicitly stated that orchestration execution is not implemented.
- `/goat mode resink` updated status to Resink.
- `/goat off` reported OFF saved; final status was OFF/Resink.
- `session_v2=0` and `session_message=0`; no `session.execution`, `rpc.invalid_output`, loader failure, ERROR, or WARN entries.
- The five existing command verbs remain the only slash surface; mode dialog and mode-response wording were clarified, with no new slash command. The internal `decide` RPC is covered by automated handler tests; the TUI smoke did not invoke a worker or model.

## Readiness for Task 3

Task 3 can consume `TaskDecisionResult` and `WorkerPrompt.tier` to execute one bounded worker session and return results to the Manager. Task 2 does not claim end-to-end orchestration; dispatch, retries, escalation, and AI audit remain unimplemented.
