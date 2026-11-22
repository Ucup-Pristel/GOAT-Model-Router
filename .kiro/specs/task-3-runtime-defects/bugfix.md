# Bugfix Requirements Document

## Introduction

The model-only POC RPC `runModelOnly` can spend more than its one allowed request when calls overlap, leaves its 30 s wait timer pending after a call settles, and records provider errors as timeouts. The Phase 3A runtime lifecycle (`validateRuntimeBudget`, `createRuntimeRun`, `beginRuntimeRun`, `runtimeEligibility`) accepts incomplete or extended budgets and over-budget execution depths, so it fails open. The auditor reproduced all five defects (DEF-1 to DEF-5) at HEAD 7934d3f.

Out of scope: native worker dispatch, Auditor execution and bounded rework (Phase 3B, blocked by the Project Owner authority gate in docs/architecture.md), the carried-over Task 2 false readiness, and generic `rpc.internal` error mapping for thrown handler errors.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN two `runModelOnly` calls with the synthetic confirmation overlap while GOAT is ON and L1 is available THEN the system calls `generate.text` twice and both calls fulfil (DEF-1)

1.2 WHEN `generate.text` settles before the 30 s wait budget expires THEN the system leaves the wait timer pending, which keeps the process alive for up to 30 s (DEF-2)

1.3 WHEN `generate.text` rejects before the wait budget expires (for example "provider 401") THEN the system records "timed_out" and later calls fail with "Model-only POC is unavailable: timed_out" (DEF-3)

1.4 WHEN `generate.text` throws synchronously THEN the system leaves the state at "running" permanently (DEF-3)

1.5 WHEN `validateRuntimeBudget` receives a budget that lacks any of the five budget keys (for example `{ maxDurationMs: 10 }`) or has an unknown key THEN the system returns it as valid (DEF-4)

1.6 WHEN a partial budget is passed to `createRuntimeRun` or `runtimeEligibility`, or is placed in a hand-built run given to `beginRuntimeRun` THEN the system creates the run, moves it to "running", and reports `allowed: true` from `runtimeEligibility` (DEF-4)

1.7 WHEN `createRuntimeRun` receives an `executionDepth` above `budget.maxExecutionDepth` (for example 5 with a maximum of 1) or one that is not a positive safe integer THEN the system stores it unchecked, and `beginRuntimeRun` moves the run to "running" (DEF-5)

1.8 WHEN `beginRuntimeRun` receives a hand-built authorized run whose `executionDepth` exceeds `budget.maxExecutionDepth` THEN the system moves it to "running" (DEF-5)

### Expected Behavior (Correct)

2.1 WHEN two `runModelOnly` calls with the synthetic confirmation overlap while GOAT is ON and L1 is available THEN the system SHALL call `generate.text` exactly once, fulfil one call, and reject the other with "Model-only POC is unavailable: running"

2.2 WHEN a `runModelOnly` call settles THEN the system SHALL clear its wait timer, leaving the number of pending timers unchanged

2.3 WHEN `generate.text` rejects before the wait budget expires THEN the system SHALL reject with the provider error, record "failed", and reject later calls with "Model-only POC is unavailable: failed"

2.4 WHEN `generate.text` throws synchronously THEN the system SHALL reject with that error and record "failed"

2.5 WHEN `validateRuntimeBudget` receives a non-object, a budget that lacks any of `maxModelRequests`, `maxDurationMs`, `maxWorkerRetries`, `maxAuditorRetries`, or `maxExecutionDepth`, a value that is not a non-negative safe integer, or an unknown key THEN the system SHALL throw an "Invalid runtime budget" error, and for a valid budget SHALL return a copy with only those five keys

2.6 WHEN a partial budget is passed to `createRuntimeRun` or `runtimeEligibility`, or is placed in a hand-built run given to `beginRuntimeRun` THEN the system SHALL throw, so no run reaches "running" and no eligibility result is returned

2.7 WHEN `createRuntimeRun` receives an `executionDepth` that is not a positive safe integer or exceeds `budget.maxExecutionDepth` THEN the system SHALL throw

2.8 WHEN `beginRuntimeRun` receives a run whose `executionDepth` exceeds `budget.maxExecutionDepth` THEN the system SHALL throw

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a non-overlapping `runModelOnly` call fails a precondition (wrong confirmation, GOAT OFF, missing L1, unavailable model, or planning failure) THEN the system SHALL CONTINUE TO reject with the current message, without calling `generate.text` and without consuming the single request

3.2 WHEN `generate.text` succeeds within the wait budget THEN the system SHALL CONTINUE TO return the current output (status, intentID, taskID, tier, model, result, elapsedMs) and reject later calls with "Model-only POC is unavailable: spent"

3.3 WHEN the 30 s wait budget expires before `generate.text` settles THEN the system SHALL CONTINUE TO reject with "Model-only POC local wait budget exhausted; provider request may still be running" and reject later calls with "Model-only POC is unavailable: timed_out"

3.4 WHEN a run uses a complete valid budget and an `executionDepth` within `maxExecutionDepth` THEN the system SHALL CONTINUE TO apply the current lifecycle checks and messages (authorization before execution, resource binding, high-impact denial, model-request cap, duration budget, cancellation) and return the current `runtimeEligibility` results

3.5 WHEN a budget has a negative value or a zero `maxDurationMs` or `maxExecutionDepth` THEN the system SHALL CONTINUE TO reject it with an "Invalid runtime budget" error

3.6 WHEN GOAT ON/OFF, Standard/Resink, L1/L2/L3 routing, the five `/goat` verbs (router, mode, on, off, status), or the `decide` RPC run THEN the system SHALL CONTINUE TO behave as the 57 existing tests assert, including the `decide` output contract
