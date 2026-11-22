# Task 3 Runtime Defects Bugfix Design

## Overview

This is the smallest fix for five confirmed defects. DEF-1 to DEF-3 are in the `runModelOnly` handler of `packages/opencode/src/index.ts`: the handler will claim its single request synchronously, clear its wait timer, and record a new "failed" state for errors that are not timeouts. DEF-4 and DEF-5 are in `packages/core/src/runtime.ts`: `validateRuntimeBudget`, `createRuntimeRun`, and `beginRuntimeRun` will check the full budget shape and the execution depth and fail closed. No other source changes.

## Glossary

- **Bug_Condition (C)**: inputs on which the current code spends a second model request, leaks the wait timer, records the wrong terminal state, or accepts an invalid budget or depth; specified by `isBugCondition`
- **Property (P)**: the correct behavior for inputs in C; specified by `expectedBehavior`
- **Preservation**: behavior for inputs outside C, which must not change
- **F / F'**: the code at HEAD 7934d3f / the fixed code
- **modelOnlyState**: per-plugin-runtime state of `runModelOnly` (index.ts line 8); after the fix "ready" | "running" | "spent" | "timed_out" | "failed"
- **Wait budget**: the 30 s local timer raced against `ctx.experimental.generate.text` (index.ts line 125)
- **Budget keys**: `maxModelRequests`, `maxDurationMs`, `maxWorkerRetries`, `maxAuditorRetries`, `maxExecutionDepth`
- **Hand-built run**: a `RuntimeRun` made by spreading an authorized run instead of calling `createRuntimeRun`

## Bug Details

### Bug Condition

The model-only defects appear when calls overlap or when generation settles before the wait budget. The runtime defects appear when a budget lacks a key or has an extra key, or when the execution depth is out of range.

**Formal Specification:**
```
FUNCTION isBugCondition(X)
  INPUT: X, either a sequence of runModelOnly calls on one plugin runtime,
         or a runtime call (fn, budget, executionDepth or run)
  OUTPUT: boolean
  RETURN isModelOnlyBug(X) OR isRuntimeBug(X)
END FUNCTION

FUNCTION isModelOnlyBug(X)
  RETURN two or more calls with the synthetic confirmation overlap     // DEF-1
      OR a call's generation settles before its 30 s timer fires       // DEF-2
      OR a call's generation rejects or throws synchronously
         before its timer fires                                        // DEF-3
END FUNCTION

FUNCTION isRuntimeBug(X)
  // budget means run.budget when fn = beginRuntimeRun
  RETURN (X.fn IN {validateRuntimeBudget, createRuntimeRun, runtimeEligibility, beginRuntimeRun}
          AND (budget is not an object
               OR some budget key is absent
               OR budget has a key that is not a budget key))         // DEF-4
      OR (X.fn = createRuntimeRun
          AND (NOT isPositiveSafeInteger(X.executionDepth ?? 1)
               OR X.executionDepth > budget.maxExecutionDepth))       // DEF-5
      OR (X.fn = beginRuntimeRun
          AND X.run.executionDepth > budget.maxExecutionDepth)        // DEF-5
END FUNCTION

FUNCTION expectedBehavior(X, result)
  INPUT: X where isBugCondition(X), result of running X on F'
  OUTPUT: boolean
  DEF-1: RETURN every call that starts while another holds "running" rejects with
                "Model-only POC is unavailable: running"
                AND generate.text is called at most once (exactly once with GOAT ON and L1 available)
  DEF-2: RETURN the pending Timeout count after the call settles = the count before the call
  DEF-3: RETURN the call rejects with the generation error
                AND the next call rejects with "Model-only POC is unavailable: failed"
  DEF-4, DEF-5: RETURN the call throws
                AND no run reaches "running" AND runtimeEligibility returns no result
END FUNCTION
```

### Examples

Observed by the auditor on F:

- DEF-1: two overlapping calls both fulfil and `generate.text` is called twice; expected one call and one rejection "unavailable: running"
- DEF-2: after one successful call, pending `Timeout` handles go from 2 to 3, and decision.test.ts takes about 30 467 ms because of it; expected 2 to 2
- DEF-3: after `generate.text` rejects "provider 401", the next call fails with "unavailable: timed_out"; expected "unavailable: failed". A synchronous throw leaves the state at "running"
- DEF-4: `validateRuntimeBudget({ maxDurationMs: 10 })` returns `{ maxDurationMs: 10 }`; with that budget, create, authorize, and begin reach `state=running`, and `runtimeEligibility` returns `allowed: true`; expected: each throws
- DEF-5: `executionDepth: 5` with `maxExecutionDepth: 1` reaches `state=running`; expected: `createRuntimeRun` throws

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- A non-overlapping call that fails a precondition (wrong confirmation, GOAT OFF, missing L1, unavailable model, planning failure) rejects with the same message, does not call `generate.text`, and leaves the state "ready"
- A successful call returns the same output and sets "spent"
- Wait-budget expiry rejects with the same message and sets "timed_out"
- Error messages, the `runModelOnly` RPC schema, and all other handlers stay the same
- Complete valid budgets with in-budget depth follow the same lifecycle and messages; negative values and zero duration or depth are still rejected

**Scope:**
All inputs outside C behave as before, including GOAT ON/OFF, Standard/Resink, L1/L2/L3 routing, the five `/goat` verbs, and the `decide` output contract (the 57 existing tests). Overlapping calls are in C: a call that starts while another holds "running" rejects with "Model-only POC is unavailable: running", even if it would have failed a precondition.

## Hypothesized Root Cause

Each cause is confirmed by the auditor's reproduction at HEAD 7934d3f:

1. **Late claim (DEF-1)**: the ready check (index.ts line 101) and `modelOnlyState = "running"` (line 120) are separated by three awaits (lines 102, 106, 108), so overlapping calls all pass the check
2. **Uncleared timer (DEF-2)**: the `setTimeout` handle created at line 125 is never stored or cleared after `Promise.race` settles
3. **Catch-all state (DEF-3)**: the `.catch` at lines 126-129 sets "timed_out" for every rejection, and `generate.text` is called at line 122 outside that catch, so a synchronous throw skips the state update
4. **Entry-based validation (DEF-4)**: `validateRuntimeBudget` (runtime.ts line 88) iterates `Object.entries(value)` (line 89), so absent keys are never checked and unknown keys pass; `beginRuntimeRun` then evaluates `0 >= undefined` (line 157) and `runtimeEligibility` evaluates `undefined === 0` (line 124), both false
5. **Depth checked only in eligibility (DEF-5)**: `createRuntimeRun` (line 128) stores `input.executionDepth ?? 1` unchecked (line 139), and `beginRuntimeRun` (line 153) has no depth check; only `runtimeEligibility` (line 123) checks depth

## Correctness Properties

Property 1: Bug Condition - Single-use model-only guard and fail-closed runtime budget and depth

_For any_ input where the bug condition holds (isBugCondition returns true), the fixed code SHALL satisfy expectedBehavior: overlapping calls reach `generate.text` at most once and the others reject with "Model-only POC is unavailable: running"; every settled call clears its wait timer; a generation error that is not a timeout records "failed"; and a partial or extended budget or an out-of-range execution depth throws before any run reaches "running" or any eligibility result is returned.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8**

Property 2: Preservation - Unaffected model-only and runtime behavior

_For any_ input where the bug condition does not hold (isBugCondition returns false), and for the result and final "spent" state of a single successful call, the fixed code SHALL produce the same result as the original code, preserving precondition rejections that do not consume the request, wait-budget expiry, valid-budget lifecycle checks, and all other plugin paths.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Only the code named below changes. No new exports or module-level declarations.

**File**: `packages/opencode/src/index.ts`

**Function**: `runModelOnly` handler (lines 98-140) and the `modelOnlyState` declaration (line 8)

**Specific Changes**:
1. **State union**: add "failed"
2. **Synchronous claim (DEF-1)**: set `modelOnlyState = "running"` right after the ready check, before the `storage.get` await. Any throw from the precondition steps (config read, GOAT ON, L1, model availability, planning) resets the state to "ready" and rethrows
3. **Timer cleanup (DEF-2)**: keep the `setTimeout` handle and `clearTimeout` it in a `finally` once the race settles
4. **Terminal state (DEF-3)**: start the timer and call `generate.text` in one synchronous step inside the guarded `try`. The timer callback sets a local `timedOut` flag before rejecting. Any rejection or synchronous throw sets "timed_out" if `timedOut` is true, otherwise "failed", then rethrows. Success still sets "spent"
5. **Unchanged**: error messages, the return value, the RPC schema in `rpc.ts`, and all other handlers

**File**: `packages/core/src/runtime.ts`

**Functions**: `validateRuntimeBudget` (line 88), `createRuntimeRun` (line 128), `beginRuntimeRun` (line 153)

**Specific Changes**:
1. **Exact budget shape (DEF-4)**: `validateRuntimeBudget` throws "Invalid runtime budget" for a non-object (null, array, primitive) and "Invalid runtime budget: <key>" for an unknown key or for a budget key whose value is missing, not a safe integer, or negative. It keeps the zero-duration and zero-depth rule and returns a new object with only the five budget keys. The signature stays `(value: RuntimeBudget): RuntimeBudget`, and the key list is declared inside the function
2. **Depth at creation (DEF-5)**: `createRuntimeRun` throws "Invalid runtime execution depth" when `input.executionDepth ?? 1` is not a positive safe integer or exceeds `budget.maxExecutionDepth`
3. **Fail closed at begin (DEF-4, DEF-5)**: after its existing state, resource, and high-impact checks, `beginRuntimeRun` calls `validateRuntimeBudget(run.budget)`, then throws "Runtime execution depth exceeds budget" when `run.executionDepth > run.budget.maxExecutionDepth`, then runs the existing model-request check
4. **Unchanged**: the `runtimeEligibility` code (it fails closed through `validateRuntimeBudget`), all other functions, types, and exports

Decisions made without asking:
- The wording of the new error messages above is chosen here; existing messages stay the same.
- The DEF-3 test also covers a synchronous throw so that requirement 2.4 has a check.

## Testing Strategy

### Validation Approach

Write the bug-condition tests and the preservation tests first and run them on unfixed code: the bug-condition tests fail and the preservation tests pass. Then apply the fix and re-run the same tests. New tests go only in `packages/opencode/test/decision.test.ts` and `packages/core/test/runtime.test.ts`, use the existing fake-context pattern, and add no dependencies.

### Exploratory Bug Condition Checking

**Goal**: Confirm each defect on unfixed code before the fix.

**Test Plan**: One explicit node:test case per defect, run on unfixed code.

**Test Cases**:
1. **DEF-1 overlap**: two overlapping calls; expect one `generate.text` call, one fulfilled call, and one rejection matching /unavailable: running/ (will fail on unfixed code)
2. **DEF-2 timer**: compare the `Timeout` count from `process.getActiveResourcesInfo()` before and after one successful call (will fail on unfixed code)
3. **DEF-3 state**: `generate.text` rejects "provider 401", and separately throws synchronously; the next call must reject with /unavailable: failed/ (will fail on unfixed code)
4. **DEF-4 budget**: `validateRuntimeBudget` rejects `{ maxDurationMs: 10 }` and a budget with an unknown key; the partial budget throws in `createRuntimeRun`, in `runtimeEligibility`, and inside a hand-built run given to `beginRuntimeRun` (will fail on unfixed code)
5. **DEF-5 depth**: `createRuntimeRun` with depth 5 and maximum 1 throws; a hand-built authorized run with depth 5 fails `beginRuntimeRun` (will fail on unfixed code)

**Expected Counterexamples**:
- Two `generate.text` calls; Timeout count 2 to 3; "unavailable: timed_out" after a provider error and "unavailable: running" after a synchronous throw; the partial budget returned as valid and reaching `state=running`; `allowed: true`; depth 5 reaching `state=running`

### Fix Checking

**Goal**: For all inputs in C, the fixed code satisfies expectedBehavior.

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition(X) DO
  result := F'(X)
  ASSERT expectedBehavior(X, result)
END FOR
```

### Preservation Checking

**Goal**: For all inputs outside C, the fixed code matches the original.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

**Testing Approach**: Explicit cases instead of a property-based library, because no dependencies may be added. Each behavior is observed on unfixed code before it is asserted.

**Test Plan**: Observe the cases below on unfixed code, then keep them passing after the fix.

**Test Cases**:
1. **GOAT OFF does not consume the request**: rejects with /GOAT is OFF/ without calling `generate.text`; after the fake storage flips to ON, the next call succeeds and `generate.text` is called once
2. **Wait-budget expiry**: with `mock.timers` for `setTimeout` and a never-resolving generation, ticking 30 000 ms rejects the call with /wait budget exhausted/, and the next call rejects with /unavailable: timed_out/
3. **Existing suite**: all 57 existing tests stay green, including a successful call followed by /spent/

### Unit Tests

- The five bug-condition cases and the two preservation cases above, in the two existing test files

### Property-Based Tests

- None added, because no PBT library may be added; Properties 1 and 2 are checked through the explicit cases above

### Integration Tests

- `npm run check` and a full `npm test` run of existing and new tests; decision.test.ts must finish without the ~30 s wait. No live-host runs
