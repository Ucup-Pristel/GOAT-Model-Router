# Verification and workspace write-back

A passing test suite is evidence about the staged files. It does not by itself mean that the Auditor accepted the change or that the checkout was updated.

## From prompt to receipt

1. The Manager can use native `glob` and `read` to discover implementation files and tests. Discovery checks `goat_discover` and host tool permissions: at most 24 distinct operations and 28 Manager requests within the existing six-minute admission deadline. Identical calls are rejected, including successful reads already in context.
2. GOAT checks the proposed inputs, write targets, protected suites and [task dependencies](orchestration.md#schedule-and-file-scope). Assignment snapshots are limited to 128 files, 16 KiB per file and 256 KiB in total. Discovery alone supports `read` with a 1-based `offset` and `limit` ≤200 lines on files up to 1 MiB; returned content remains ≤16 KiB. Checked snapshots are returned instead of reopening the live path.
3. Review the `goat_workspace` permission: it identifies files, model destinations and the proposed work. OpenCode can prompt or use an applicable permission rule. Neither the Manager nor a Worker can widen the approved scope.
4. The selected protected checks run against the Workers' combined edits in staging. An Auditor using a model distinct from every Worker reviews the evidence against the original requirements. Unsupported verification cannot authorize write-back.
5. After verification, `goat_apply` checks permission for the specific outputs. GOAT compares staging with the verified result and rechecks the checkout. A denied apply or a conflicting user edit can prevent a write even when all tests passed.

## Reading `goat_verify_text`

`checksPassed` describes staging accepted by both checks and audit. To see what happened in the checkout, inspect `application.status` and the path lists:

| Field | Meaning |
|---|---|
| `written` | Writes confirmed by the helper. |
| `applied` | Confirmed outputs that still matched at the final check. |
| `conflicts` | Inputs that changed or were in use. |
| `unapplied` | Outputs not applied or no longer matching the verified result. |
| `uncertain` | Writes whose outcome could not be established after interruption. Inspect `detail` and the actual files before retrying. |
| `createdDirectories` | Directories reported as created during write-back. |

Multi-file application is not atomic. The Linux helper obtains a write lease and compares existing bytes before changing a file; it creates a new file only if its target name is free. Unsupported filesystems can prevent application. Cancellation can stop later files while an in-progress write finishes. GOAT does not roll back over concurrent edits.

For a concrete prompt, expected paths and receipt, see the [calculator example](../README.md#example-repair-a-calculator).

## Profiles

`goat_verify_text` remains an internal tool, not a new public command. Its optional `verification` object has `profile`, `command` (exact argv), and `protected` (additional immutable paths).

| Profile | Evidence |
|---|---|
| `python` | Existing protected `unittest` suites, with the original Landlock/seccomp restrictions, nonzero tests, no skips or expected failures. |
| `node` | `["node","--test","tests/example.cjs"]`; explicit immutable test paths required. |
| `typescript` | `["tsc","--noEmit","src/example.ts"]` or `["tsc","--noEmit","--project","tsconfig.json"]`. Configuration is immutable. This is type checking, not a claim that runtime tests ran. |
| `rust` | `["cargo","test","--offline","--locked"]` or `["cargo","check","--offline","--locked"]`; immutable `Cargo.toml` and `Cargo.lock`. |
| `documentation` | Nonempty `.md`, `.txt`, `.rst`, no conflict markers, plus independent semantic review. |
| `configuration` | Nonempty valid JSON, no conflict markers, plus independent semantic review. |
| `analysis` | Original authorized inputs, observed tool evidence, findings and independent review; no source changes or write-back gate. |
| `unsupported` | No protected write-back. |

Without an explicit profile, zero writes select analysis, Python suites select Python, documentation/JSON-only writes select their inspection profiles, and other writes select unsupported.

Commands require separate `goat_check` authorization, bound to the snapshot and exact command. `npm test` / `npm run NAME` may name an existing protected package script only when it resolves to a supported direct argv above. GOAT validates and executes that argv, **without npm lifecycle hooks or a shell**. Compound/dynamic scripts, arbitrary additional commands, informational flags, traversal and writable test entrypoints are rejected.

Command results count completed checks, not fabricated unit-test counts. Failures, missing toolchains, unavailable isolation, and unsupported scripts never become successful checks. Python's existing guarantees are unchanged.
Check-to-task attribution is host-derived. Rework requires a repeated matching failed check and unchanged evidence hash; volatile command output such as durations is not used as failure identity. Documentation/configuration checks belong to their file's assigned writer.

Tests, recognized runner configuration, supplied `protected` inputs, manifests, lockfiles, `AGENTS.md` and OpenCode configuration cannot be Worker write targets. Editing such policy needs a separately designed Owner workflow; a Worker cannot authorize it.
Recognized embedded test definitions conservatively protect their entire source file; split tests from implementation before assigning edits. GOAT does not claim to discover every custom test framework from arbitrary source.

## Read-only execution

Submit `tasks: [{read: ["backend/server.js"], write: []}], tests: []`. The original instruction is preserved. Workers inspect assigned snapshots and return findings directly. The Auditor receives original inputs and recorded tool evidence, with separate read-only grants. Normal analysis uses no disk staging. Authorized terminal inspection uses a temporary, read-only per-role snapshot that is removed afterward.

Success returns `reason: "analysis_accepted"`, `verification: "not_applicable"`, `checksPassed: false`, and `application.status: "not_applied"`. `output` contains the findings. This does not claim verified code changes.

## Diagnostics

Receipts and hash-chained traces include phase, stable `GOAT_*` error code, readiness, review finding codes, scope-evidence hashes, selected tier/model, tool availability, Worker/Auditor status and actual role request counts. Tool events record identity, input/output fingerprints, success or rejection. Cancellation and timeout have separate codes.

Unknown exception bodies, provider responses, stacks, raw prompts, credentials and environment values are excluded from diagnostics. Full input/tool evidence remains bounded task data for the authorized models, not journal data. A readiness failure with zero role requests is distinct from Worker, audit and verification failures.
