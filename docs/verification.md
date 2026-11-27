# Verification and workspace write-back

A passing test suite is evidence about the staged files. It does not by itself mean that the Auditor accepted the change or that the checkout was updated.

## From prompt to receipt

1. The Manager can use native `glob` and `read` to discover implementation files and tests. Discovery checks `goat_discover` and host tool permissions and is limited to six operations. The proposed paths are relative to the workspace.
2. GOAT checks the proposed inputs, write targets, protected suites and [task dependencies](orchestration.md#schedule-and-file-scope). Text snapshots are limited to 16 KiB per file and 256 KiB in total.
3. Review the `goat_workspace` permission: it identifies files, model destinations and the proposed work. OpenCode can prompt or use an applicable permission rule. Neither the Manager nor a Worker can widen the approved scope.
4. Protected tests run against the Workers' combined edits in staging. An Auditor using a model distinct from every Worker reviews the evidence against the acceptance criteria. Other text can be staged, but a suite outside the [supported verifier profile](compatibility.md#workspace-verifier) cannot authorize write-back.
5. After verification, `goat_apply` checks permission for the specific outputs. GOAT compares staging with the verified result and rechecks the checkout. A denied apply or a conflicting user edit can prevent a write even when all tests passed.

## Reading `goat_verify_text`

`checksPassed` describes staging. To see what happened in the checkout, inspect `application.status` and the path lists:

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
