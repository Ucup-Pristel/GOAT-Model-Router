# Task 2 Option A — implementation verification

**This is implementation self-verification, not an independent audit.** The independent verdict is recorded in `docs/auditor-report-task-2-option-a.md`. Round 1 returned FAIL; rework round 1 is implemented and awaits re-audit. Task 2 is not accepted, and Task 3 has not started.

## Branch and state

- Branch: `dev/task-2-scope-redesign` (created from `main` at `f6e6dbb`).
- `main` and `origin/main` remain at `f6e6dbb`.
- Changes are uncommitted; nothing was pushed, merged, or published.

## Design changes

- Added `ScopeFinding`, `ScopeFindingCode`, `ScopeFindingSeverity`, and `DispatchReadiness` contracts.
- Replaced the hard `assertTaskInScope` gate with advisory `collectScopeFindings`, `collectInstructionFindings`, `collectIntentFindings`, and `collectRiskFindings`.
- Findings are collected from both the original instruction and each planned task objective. A benign outcome, user plan, or Resink list therefore does not by itself suppress a finding for recognized risky original text that remains in `OriginalIntent` and the worker prompt.
- Direct `create`/`build`/`update` (and `make`/`prepare`/`produce`/`cut`) release/deploy/publish/ship/push commands produce review findings even though those verbs normally mark planning work. The direct-action check allows arbitrary tokens, including version tokens (`Create the v2 release`, `Create version 2 release`, `Build release v3`), between the verb and the release/deploy noun. Documentation/planning objects such as `Create a deployment guide` and `Update release notes` remain non-action context.
- Status-report detection no longer treats `work` as the verb `works`, so `Ship work to all customers` and similar action phrases are not skipped.
- Path tokens are removed before action detection, so `Update src/deploy/config.ts`, `Update docs/release/notes.md`, and path-plus-command connectors remain correctly classified.
- `TaskDecisionResult` now carries `scopeFindings`, `reviewReasons`, and `readiness`.
- `status: "needs_review"` is returned when an explicit list has no actionable item; zero tasks and a `no-actionable-task` finding are returned instead of inventing work.
- Natural-language scope findings no longer throw in `decideTask`, `planResink`, or `compileWorkerPrompt`. Worker prompts include advisory findings from both the instruction and the task.
- Deterministic validators still reject malformed intent, task, plan, routing, prompt, verification, scope-finding, and decision-result shapes.
- `readiness: "ready"` is rejected by result validation when intent ambiguities, high-risk tasks, review-level findings, or review reasons exist. This is a consistency rule, not a guarantee that the heuristic detects every risky phrasing.
- The internal `decide` RPC exposes `readiness` at the envelope level and in `result`; its JSON schema was updated.

## Automated evidence

- `npm run check`: clean.
- `npm test`: **48/48 pass** (Task 1 regressions included).
- `npm pack --dry-run --workspace @goat/opencode`: 4 files, 3.8 kB, 4-file tarball manifest, no tarball written.
- `npm audit --json`: 24 moderate, 0 high, 0 critical.
- Source scan: exactly one slash command registration (`/goat`), no server command hook, no session creation, model generation, tool execution, `child_process`, or `fetch`.
- Targeted probe (executed with `tsx`) verified:
  - `Update src/config+deploy service`, `Fix docs/release/notes+push production`, and `Update publish/docs+run npm publish` plan with review findings instead of throwing.
  - `Create the release for all customers`, `Create the release`, `Build a release candidate for all customers`, `Update the release package for all customers`, `Create a deployment`, and `Build the production deployment` all return `readiness: "needs_review"` with `possible-out-of-scope-action` findings.
  - `Ship work to all customers`, `Release work to all customers`, `Deploy work to the production environment`, `Publish work to all customers`, and `Push work to the remote repository` return `needs_review`; `work` is no longer mistaken for the status verb `works`.
  - `Create the v2 release for all customers`, `Build a v2 release candidate for all customers`, `Update a v2 release package for all customers`, `Create version 2 release for all customers`, `Create v2 production deployment for all customers`, and `Build release v3 for all customers` return `needs_review`, including when a benign outcome masks them.
  - Planning/documentation counterparts (`Create the v2 deployment guide`, `Update v2 release notes`, `Build version 2 deployment pipeline`, `Make a deployment plan`, `Prepare a release checklist`, `Produce a deployment report`, `Cut a release notes draft`) produce no possible-action finding.
  - `Update deploy script`, `Create a deployment guide`, `Build the deployment pipeline`, `Update the release schedule`, `Update release notes`, `Create release documentation`, and `Update push API` produce no possible-action finding.
  - A benign outcome does not mask `Deploy the service to production and push main`; the decision is `needs_review`, the instruction-level findings have no `taskId`, and the worker prompt contains the advisory findings.
  - A user plan or Resink list (`Update the README`) does not mask the same risky instruction; both decisions are `needs_review`.
  - `Would you mind reviewing deployment`, `Please help reviewing deployment`, `Please make sure to review deployment`, `Please help me review deployment`, `Kindly review deployment`, `The deployment failed`, `The deployment completed`, `The deployment was broken`, `The deployment got broken`, `The deployment broke`, `The release notes need an update`, and `The release notes are wrong` produce no possible-action finding.
  - Heading-only lists return `status: "needs_review"`, `readiness: "needs_review"`, zero tasks, and `no-actionable-task`.
  - Mixed heading lists skip headings and plan only the real task.
  - A fully specified low-risk request is `ready`; ambiguous and risky requests are `needs_review`.
  - GOAT OFF returns `bypassed` / `not_applicable` with no findings.
  - Injecting a review finding into a `ready` result is rejected by `validateTaskDecisionResult`. This is a consistency check, not a full tamper-proof validation of every plan field.

## Host smoke evidence

- Isolated root: `/tmp/opencode/goat-2a5-test`; `HOME=/tmp/opencode/goat-2a5-home`; `XDG_CONFIG_HOME=/tmp/opencode/goat-2a5-xdg`.
- Plugin copied to a real directory and loaded by OpenCode 2.3.2 with Node 22.22.1.
- `/goat status` -> OFF, Standard, Manager inherit, all tiers unconfigured, orchestration not implemented.
- `/goat on` -> ON saved with an explicit execution-unimplemented message.
- `/goat mode resink` -> persisted Resink.
- `/goat off` -> OFF saved; final status OFF/Resink.
- `session_v2 = 0`, `session_message = 0`; no ERROR/WARN entries from the smoke run.
- Copied `index.ts`, `rpc.ts`, and `tui.ts` SHA-256 hashes match the repository.
- Capture: `/tmp/opencode/goat-2a5-tui.raw`.

## Independent audit status

- Round 1 verdict: **FAIL**. Blocking findings were false readiness for direct release commands and risky instructions masked by a benign outcome, user plan, or Resink list, plus documentation overclaims.
- Rework round 1 fixed the exact round 1 reproductions.
- Round 2 verdict: **FAIL**. Residual false readiness: `work` was treated as the status verb `works` (`Ship work to all customers`), and version tokens defeated the direct `create`/`build`/`update` override (`Create the v2 release`).
- Rework round 2 fixed those literal cases and added regression coverage.
- Round 3 verdict: **FAIL**. Recognized high-risk original instructions (`Delete the production database`, `Update production credentials`, `Change the authentication secret`, `Run the production migration`) were still `ready` when a benign outcome/user plan/Resink list supplied the task objective, because risk analysis only ran on the objective. Additional release/deploy verbs (`add`, `remove`, `implement`, `fix`, `develop`, `design`, `write`) still bypassed the scan.
- The two-rework limit is exhausted. Task 2 is **not accepted**; implementation stopped. Task 3 must not start without explicit Project Owner approval.
