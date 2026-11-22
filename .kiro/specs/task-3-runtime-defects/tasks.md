# Implementation Plan

- [x] 1. Write bug condition exploration tests (DEF-1 to DEF-5)
  - **Property 1: Bug Condition** - Single-use model-only guard and fail-closed runtime budget and depth
  - **CRITICAL**: These tests MUST FAIL on unfixed code; the failures confirm the bugs. Do not fix the tests or the code when they fail
  - **GOAL**: Surface counterexamples for `isBugCondition` from design; assertions follow `expectedBehavior`
  - DEF-1 (decision.test.ts, existing fake context with GOAT ON and L1 available): start two `runModelOnly({ confirm: "GOAT_MODEL_ONLY_SYNTHETIC" })` calls together and `Promise.allSettled` them; assert `generate.text` was called once, one call fulfilled, and the other rejected with `/unavailable: running/`
  - DEF-2 (decision.test.ts): count `"Timeout"` entries in `process.getActiveResourcesInfo()` before and after one successful call; assert the counts are equal
  - DEF-3 (decision.test.ts): with `generate.text` rejecting `new Error("provider 401")`, assert the call rejects with `/provider 401/` and the next call rejects with `/unavailable: failed/`; repeat with `generate.text` throwing synchronously
  - DEF-4 (runtime.test.ts, malformed budgets cast `as never`): assert `validateRuntimeBudget` throws `/Invalid runtime budget/` for `{ maxDurationMs: 10 }` and for `{ ...dryRunBudget, extra: 1 }`, and that `createRuntimeRun` and `runtimeEligibility` (decision stubbed as `{ intent }`) throw with `{ maxDurationMs: 10 }`
  - DEF-5 (runtime.test.ts): assert `createRuntimeRun` throws for `executionDepth: 5` with `maxExecutionDepth: 1`, and `beginRuntimeRun` throws for an authorized run spread with `executionDepth: 5` and for one spread with `budget: { maxDurationMs: 10 }`
  - Run `npm test` on UNFIXED code. **EXPECTED OUTCOME**: these tests FAIL
  - Record the observed failures (expected: 2 `generate.text` calls, Timeout count +1, `unavailable: timed_out` and `unavailable: running`, partial budget accepted, `allowed: true`, `state=running`)
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

- [x] 2. Write preservation tests (BEFORE implementing the fix)
  - **Property 2: Preservation** - Unaffected model-only and runtime behavior
  - **IMPORTANT**: Follow observation-first methodology: confirm each behavior on UNFIXED code before asserting it
  - GOAT OFF (decision.test.ts): with storage returning `enabled: false`, assert the call rejects with `/GOAT is OFF/` and `generate.text` was not called; flip the fake storage to `enabled: true` and assert the next call succeeds and `generate.text` was called once
  - Wait budget (decision.test.ts): `t.mock.timers.enable({ apis: ["setTimeout"] })`; `generate.text` returns a never-resolving promise and signals when called; after the signal, `t.mock.timers.tick(30_000)`; assert the call rejects with `/wait budget exhausted/` and the next call rejects with `/unavailable: timed_out/`
  - Keep the 57 existing tests unchanged
  - Run `npm test` on UNFIXED code. **EXPECTED OUTCOME**: the new preservation tests and the 57 existing tests PASS
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 3. Fix DEF-1 to DEF-3 in index.ts

  - [x] 3.1 Implement the runModelOnly fix
    - Add "failed" to the `modelOnlyState` union
    - Set "running" right after the ready check, before the first await; any throw before generation resets the state to "ready" and rethrows
    - Start the timer and call `generate.text` in one synchronous step inside the guarded block; the timer callback sets `timedOut`; on rejection or synchronous throw set "timed_out" if `timedOut`, else "failed"; `clearTimeout` in `finally`; success sets "spent"
    - Keep error messages, the return value, and the RPC schema unchanged; change nothing else in the file
    - _Bug_Condition: isModelOnlyBug(X) from design_
    - _Expected_Behavior: expectedBehavior DEF-1 to DEF-3 from design_
    - _Preservation: Preservation Requirements from design_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.6_

  - [~] 3.2 Verify the DEF-1 to DEF-3 exploration tests now pass
    - **Property 1: Expected Behavior** - Single-use model-only guard and fail-closed runtime budget and depth
    - **IMPORTANT**: Re-run the same tests from task 1; do not write new tests
    - **EXPECTED OUTCOME**: the DEF-1 to DEF-3 tests PASS; the DEF-4 and DEF-5 tests still fail until task 4
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [~] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Unaffected model-only and runtime behavior
    - **IMPORTANT**: Re-run the task 2 tests and the existing suite; do not write new tests
    - **EXPECTED OUTCOME**: they PASS
    - _Requirements: 3.1, 3.2, 3.3, 3.6_

- [ ] 4. Fix DEF-4 and DEF-5 in runtime.ts

  - [~] 4.1 Implement the budget and depth checks
    - `validateRuntimeBudget`: reject non-objects, missing budget keys, values that are not non-negative safe integers, and unknown keys with "Invalid runtime budget" errors; keep the zero-duration and zero-depth rule; return a copy with only the five keys
    - `createRuntimeRun`: throw "Invalid runtime execution depth" when `input.executionDepth ?? 1` is not a positive safe integer or exceeds `budget.maxExecutionDepth`
    - `beginRuntimeRun`: after the existing state, resource, and high-impact checks, call `validateRuntimeBudget(run.budget)`, then throw "Runtime execution depth exceeds budget" when `run.executionDepth > run.budget.maxExecutionDepth`, then keep the model-request check
    - Change no other function, type, or export
    - _Bug_Condition: isRuntimeBug(X) from design_
    - _Expected_Behavior: expectedBehavior DEF-4 and DEF-5 from design_
    - _Preservation: Preservation Requirements from design_
    - _Requirements: 2.5, 2.6, 2.7, 2.8, 3.4, 3.5, 3.6_

  - [~] 4.2 Verify the DEF-4 and DEF-5 exploration tests now pass
    - **Property 1: Expected Behavior** - Single-use model-only guard and fail-closed runtime budget and depth
    - **IMPORTANT**: Re-run the same tests from task 1; do not write new tests
    - **EXPECTED OUTCOME**: all task 1 tests PASS
    - _Requirements: 2.5, 2.6, 2.7, 2.8_

  - [~] 4.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Unaffected model-only and runtime behavior
    - **IMPORTANT**: Re-run the task 2 tests and the existing suite; do not write new tests
    - **EXPECTED OUTCOME**: they PASS
    - _Requirements: 3.4, 3.5, 3.6_

- [~] 5. Checkpoint - Ensure all tests pass
  - `npm run check` is clean
  - `npm test` passes the 57 existing tests and all new tests
  - decision.test.ts no longer waits ~30 s for a pending timer
  - Ask the user if questions arise
