# Orchestration

## From a Build prompt to a task

With GOAT OFF, prompts bypass planning and dispatch. When enabled, the Manager uses the session model or an explicitly selected model. The core preserves the instruction, constraints, prohibitions, acceptance criteria and user plan in `OriginalIntent`. Each `TaskSpecification` carries the constraints and criteria into the Worker prompt and verification requirements.

**Standard** follows the user's plan or starts from one objective. **Resink** also gives a supplied plan priority, but permits planning when none exists. Ordinary workspace execution requires Standard.

The core selects a configured capability tier from complexity, risk and context: L1 for straightforward work, L2 for intermediate work and L3 for complex, high-risk or broad-context work. A task may request an explicit tier. The `RoutingDecision` records the provider/model pair, reasons and uncertainties. Missing assignments and unavailable models produce errors. Ambiguity, high risk or review-level scope findings can mark a task `needs_review`; natural-language findings do not enforce permissions.

## Concurrent Workers

An ordinary workspace run accepts up to four tasks and runs up to three Workers at once. Standard preserves the user's order unless the instruction authorizes independent work. A dependent task becomes ready only after its predecessor's edits have been integrated.

The [RGB example schedule](../tests/milestone/parallel-project/schedule.json) illustrates the rule: three independent tasks write `red.py`, `green.py` and `blue.py`. A fourth task reads all three to implement `rgb()` in `palette.py`. A free Worker slot cannot start `rgb()` while any of those inputs is missing.

## Schedule and file scope

- `dependsOn` refers to task IDs (`task-1`, `task-2`, …). Missing references and cycles are rejected before dispatch.
- Each task declares its `read` and `write` paths. A file has at most one writer. A task reading another task's output must depend on its writer, directly or transitively.
- `criteria` are passed to the Worker and Auditor. `suites` identify protected checks; naming a suite does not grant the Worker access to edit it.
- Each Worker edits a scoped snapshot. The scheduler integrates valid changes before making them available to successors. An optional `tier` selects among the configured L1/L2/L3 assignments.

The signed project profile used by the regression suite can specify `concurrency` (1–4, default 3) and `maxRequests` (1–48, default 48). Those limits apply to the whole schedule. The ordinary workspace path does not require a signed schedule file.

## Lifecycle and rework

The normal lifecycle is `queued → classifying → delegated → auditing → completed`. A reproducible defect can trigger one bounded rework round, with escalation to a higher tier where available. Affected descendants are revalidated; independent branches need not run again. Failure interrupts other active Workers, and cancellation stops new tasks from starting.

The signed project profile leaves its result in staging. For an ordinary workspace, [applying verified edits](verification.md) is a separate permission decision.
