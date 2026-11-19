# Task 2 Option A — Independent Auditor report

Repository: `/home/agent/workspace/GOAT-Model-Router`
Branch: `dev/task-2-scope-redesign`
Date: 2026-11-19
Auditor: independent read-only subagent

## Round 1 verdict: FAIL

Option A is a genuine improvement over the old hard gate: the specified path/polite/heading/readiness probes passed, no execution surface was added, and the host smoke evidence was clean. However, the decision layer could still return `readiness: "ready"` for genuine release/deploy instructions in valid requests. That is false readiness, not a tolerable advisory false positive.

Task 2 is not accepted. Task 3 must not start without explicit Project Owner approval.

### Checklist

| Check | Result |
|---|---|
| Branch/status/main/origin integrity | PASS — `dev/task-2-scope-redesign`; HEAD/main/origin at `f6e6dbb`; changes uncommitted. |
| `npm run check` / `npm test` | PASS — typecheck clean; 47/47 tests passed at audit time. |
| Old hard gate removed and dangerous-language probes | PASS — no `assertTaskInScope`; connector probes plan with review findings. |
| Polite/past/status forms | PASS — no possible-action findings. |
| Heading-only and mixed lists | PASS — heading-only `needs_review` with zero tasks; mixed list plans the real task. |
| Fully specified ready / ambiguous / high-risk | PARTIAL — specified probes passed, but adversarial valid release requests could be `ready`. |
| Malformed contract rejection | PASS for required cases. |
| GOAT OFF | PASS — `bypassed` / `not_applicable`, no findings. |
| No execution surface | PASS — no session creation, model generation, tool execution, `child_process`, or `fetch`; only live model catalog reads. |
| One slash / five verbs / RPC readiness | PASS — one `/goat` registration; five verbs; RPC schema requires `readiness`. |
| Host smoke evidence | PASS — plugin loaded, no ERROR/WARN, zero sessions, hashes matched. |
| Docs/source consistency | FAIL — overclaims contradicted by the false-readiness cases. |

### Blocking findings

#### B1. Direct release commands could be marked `ready`

Locations: `packages/core/src/manager/scope.ts:6`, `scope.ts:69`, `packages/core/src/manager/routing.ts:10`.

Reproductions:

```text
instruction: "Create the release for all customers."
acceptanceCriteria: ["The requested work is complete."]
→ status: "planned", readiness: "ready", risk: "low", scopeFindings: []
```

Also `Build a release candidate for all customers.` and `Update the release package for all customers.` returned `ready` with no findings.

Cause: `create`, `build`, and `update` were planning-verb prefixes that skipped the action scan, and the high-risk pattern omitted `release`, `ship`, and `push`.

Why blocking: `readiness` is the contract Task 3 uses to refuse automatic dispatch. A fully specified release request marked `ready` is false readiness.

Docs contradicted: `docs/task-2-manager.md:105`, `README.md:35`.

#### B2. A benign outcome, user plan, or Resink list could mask a risky original instruction

Locations: `packages/core/src/manager/pipeline.ts:184-187`, `planner.ts:141`, `planner.ts:165,176,188-194`, `prompt.ts:23`.

Reproductions:

```text
instruction: "Deploy the service to production and push main."
outcome: "The requested documentation update is complete."
acceptanceCriteria: ["The requested work is complete."]
→ status: "planned", readiness: "ready", scopeFindings: []
```

The same happened when a user plan (`Update the README.`) or a Resink list masked the instruction. The risky text remained in `OriginalIntent` and the worker prompt.

Why blocking: a Task 3 dispatcher honoring `readiness` would see `ready` while the prompt contained “Deploy the service to production and push main.”

Docs contradicted: `docs/scope-redesign-verification.md:34`.

#### B3. Documentation overclaimed safety coverage

- `docs/task-2-manager.md:105` claimed common release command phrasings produce advisory findings.
- `README.md:35` claimed only a fully specified low-risk decision is `ready`.
- `docs/scope-redesign-verification.md:34` claimed ambiguous and risky requests are `needs_review`.
- `docs/scope-redesign-verification.md:36` overclaimed tamper-proof ready-result validation.

### Non-blocking observations

- Feature-delivery allow (`Release the latest feature to all users.`) is intentional but risky; documented and tested.
- `validateTaskDecisionResult` does not cross-check every plan field against the result. Not reachable through the normal pipeline, but a hardening gap for Task 3.
- Polite/past/status forms still return `needs_review` through ambiguity/high-risk findings. Conservative and safe.
- README “low-risk” wording was imprecise; the precise rule is no ambiguity, no high-risk task, and no review-level finding.
- Host smoke isolation was partial: `node_modules` was a symlink to the repository. TUI/zero-session evidence remained valid.
- Dependency audit: 24 moderate, 0 high, 0 critical.

## Rework round 1

Implemented after the round 1 verdict:

1. Scope findings are collected from `OriginalIntent.instruction` as well as task objectives, and worker prompts include both.
2. Direct `create`/`build`/`update` (and `make`/`prepare`/`produce`/`cut`) release/deploy/publish/ship/push commands override the planning-verb suppression; documentation/planning objects remain non-actions.
3. Path tokens are stripped before action detection.
4. Regression tests cover B1 and B2.
5. Documentation now states the precise readiness rule and the instruction-level scan.

## Round 2 verdict: FAIL

Round 2 rework fixed the exact round 1 B1/B2 reproductions, but independent adversarial probing found remaining false readiness in the same release/deploy/push family.

### Blocking findings

#### B1. Risky commands containing “work” were misclassified as status reports

Location: `packages/core/src/manager/scope.ts:65`. `statusPredicate` treated `work` as the verb `works`, so `ship work`, `release work`, `deploy work`, `publish work`, and `push work` were skipped as status reports. `routing.ts:10` still omitted release/ship/push from the high-risk pattern.

Reproductions:

```text
"Ship work to all customers." → ready, scopeFindings: []
"Release work to all customers." → ready
"Deploy work to the production environment." + benign outcome → ready
"Push work to the remote repository." + benign outcome → ready
```

#### B2. Version tokens defeated the direct release/deploy override

Location: `packages/core/src/manager/scope.ts:11`. The direct-action regex only allowed articles/adjectives between the verb and the release/deploy noun, so version tokens broke the match and the planning-verb suppression returned.

Reproductions:

```text
"Create the v2 release for all customers." + benign outcome → ready
"Build a v2 release candidate for all customers." → ready
"Update a v2 release package for all customers." → ready
"Create version 2 release for all customers." → ready
"Create v2 production deployment for all customers." → ready
```

#### B3. Documentation still overclaimed coverage

The categorical masking/direct-command/readiness claims in README, architecture, task-2-manager, and scope verification were contradicted by the reproductions above.

### Non-blocking observations

- Conservative false positives remained for `Make a deployment plan`, `Prepare a release checklist`, `Cut a release notes draft`, `Produce a deployment report`, and `Build a deployment app`.
- `validateTaskDecisionResult` still does not fully cross-check every plan field against the result.
- `routing.ts` still omits release/ship/push from the high-risk pattern; not independently blocking when scope findings fire.

## Rework round 2

Implemented after the round 2 verdict:

1. Removed `works?`/`worked` from status-report detection so `work` is treated as an object, not a status verb.
2. Replaced the qualifier-only direct-action regex with a first-action-word scan: any `create`/`build`/`update`/`make`/`prepare`/`produce`/`cut` clause containing a release/deploy/publish/ship/push word is direct unless the text after that word is a safe planning object. Version tokens and arbitrary intervening tokens are therefore covered.
3. Added `make`/`prepare`/`produce`/`cut` to planning-verb suppression so their documentation/planning forms remain non-actions.
4. Added regression cases for all round 2 reproductions, including masked-outcome variants, plus benign version-token planning forms.
5. Softened documentation claims: recognized direct commands and recognized risky text are covered, but the heuristic can still miss unknown phrasings, so Task 3 must enforce permissions.

## Round 3 verdict: FAIL

The literal round 2 B1/B2 reproductions were fixed, but two residual false-readiness paths remained in the same class.

### Blocking findings

#### 1. Recognized high-risk original instructions were not risk-analyzed

Locations: `packages/core/src/manager/pipeline.ts:188-201`, `pipeline.ts:206-227`, `pipeline.ts:241-242`; `routing.ts:10`; `scope.ts:112-114`, `scope.ts:125-134`.

Instruction-level scope findings were added, but risk analysis still ran only on the task objective. A benign `outcome`, `userPlan`, or Resink list replaced the objective, so high-risk terms in `OriginalIntent.instruction` were never analyzed:

```text
instruction: "Delete the production database."
outcome: "The requested documentation update is complete."
acceptanceCriteria: ["The requested work is complete."]
→ status: "planned", readiness: "ready"
→ scopeFindings: [], reviewReasons: []
→ prompt still contains "Original request: Delete the production database."
```

The same `ready` result occurred for `Update production credentials`, `Change the authentication secret`, `Run the production migration`, `Rotate production credentials`, `Disable the production auth service`, and `Drop the production database table` with a benign outcome, user plan, or Resink list.

#### 2. Non-direct planning verbs still bypassed release/deploy actions

Locations: `scope.ts:11`, `scope.ts:21-27`, `scope.ts:91`.

`directActionVerb` covered only `create`/`build`/`update`/`make`/`prepare`/`produce`/`cut`. Other planning verbs were suppressed unconditionally, so `add`, `remove`, `implement`, `fix`, `develop`, `design`, and `write` release/deploy forms could be `ready`:

```text
instruction: "Add release v3 to production."
outcome: "The requested documentation update is complete."
→ readiness: "ready", scopeFindings: []
```

Also: `Remove the release from production`, `Implement the v2 release`, `Fix the production deployment`, `Develop the v2 release`, `Add the release to the registry`.

### What passed

- Literal round 2 B1/B2 cases and additional create/build/update/make/prepare/cut variants.
- Benign planning counterparts.
- Connector/path probes, polite/past/status forms, heading-only and mixed lists, fully specified ready, ambiguity, direct high-risk deploy, malformed contracts, GOAT OFF.
- Worker prompts included instruction-level advisory findings for recognized scope text.
- No execution surface, one `/goat` slash registration, five verbs, RPC readiness schema.
- Host smoke: zero sessions, no ERROR/WARN, hashes matched.

### Acceptance

Task 2 Option A did not satisfy the Project Owner's requirements. The two-rework limit was exhausted, so implementation stopped. Task 3 must not start without explicit Project Owner approval.

## Final status

**FAIL.** No further rework was performed after round 3, per the Project Owner's maximum-two-rework-rounds rule. Task 2 remains uncommitted on `dev/task-2-scope-redesign`; nothing was pushed or merged.


