# GOAT Model Router

GOAT lets one OpenCode Build session delegate a scoped change to other models, test the result, and ask a separate model to review the evidence **before changing your checkout**. Use it when you want to choose which model plans, implements and reviews a task, and to see what actually passed. GOAT starts **OFF**.

```text
Your prompt in OpenCode Build
            │
            ▼
  Manager: original intent + proposed file scope
            │ OpenCode permissions
            ▼
  Portable core: route → schedule ready Workers (L1 / L2 / L3)
            │                    │ scoped edits in staging
            ▼                    ▼
  Protected tests ──────► independent Auditor
                                │ bounded rework or verified result
                                ▼
  OpenCode: apply permission → conflict check → checkout + receipt
```

OpenCode is the first production adapter for the portable GOAT core. Your provider connections, OAuth, tools, permissions and child sessions belong to OpenCode. There is no GOAT account, daemon or separate API key.

## Install

**Candidate status:** the npm packages are not published. To try the candidate now, use the two local tarballs as described below. The registry commands are for use **after publication** under the approved names.

| Where to load GOAT | Native installation after publication |
|---|---|
| All your OpenCode projects | Run `opencode plugin add @goat/opencode`. OpenCode installs the matching core and adds the plugin to your user configuration. |
| Just one project | Append `"@goat/opencode@0.1.0"` to `plugins` in that project's `opencode.json(c)` or `.opencode/opencode.json(c)`. OpenCode resolves it for that project and its descendants. |

For the **unpublished candidate**, place both archives in the same directory. From that directory on Linux:

```sh
install_dir="${XDG_DATA_HOME:-$HOME/.local/share}/goat-candidates/0.1.0"
npm install --offline --ignore-scripts --no-audit --prefix "$install_dir" \
  "$PWD/goat-core-0.1.0.tgz" "$PWD/goat-opencode-0.1.0.tgz"
printf '%s\n' "$install_dir/node_modules/@goat/opencode"
```

Append the **printed absolute directory** as one entry in `plugins`. For global use, edit `${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.json(c)`; for project-only use, edit the project config above. Keep the existing entries, comments and all other settings. If `plugins` is absent, add that field. Do not copy provider credentials, replace a config file, or install both ways. OpenCode loads the server, terminal UI and RPC contract from the one entry. A `.tgz` is not itself a native plugin directory.

## Quick start

1. Open a trusted Linux workspace in the **OpenCode terminal UI**. Choose **Build** and a tool-capable model from your existing provider connection.
2. Run `/goat status`. With fresh plugin storage it shows `Enabled: false`, `Mode: standard`, Manager inherited, other roles unconfigured.
3. Open `/goat router`. Keep **Inherit current session model** or select a Manager. Select L1, L2, L3 and an Auditor different from every Worker. The picker saves after the last selection; cancelling leaves the previous assignments in place.
4. Choose **Standard** in `/goat mode`, then `/goat on`. Send a plain prompt. Review the proposed files, tests, model destinations and permissions before approving.
5. Inspect the `goat_verify_text` tool receipt, then `/goat off` when finished.

### Five commands

| Command | Result |
|---|---|
| `/goat router` | Pick enabled provider/model pairs for the five roles. |
| `/goat mode` | Choose Standard or Resink. |
| `/goat on` | Save activation. No task starts until you submit a prompt. |
| `/goat off` | Save deactivation and cancel work at this location. Subsequent ordinary prompts bypass GOAT. |
| `/goat status` | See activation, mode, assignments, unavailable models and execution state. |

**Installation scope and settings scope are different.** Project config controls *where the plugin loads*. On OpenCode 2.4.2 the roles, mode and ON/OFF flag are durable GOAT plugin storage in the host database. Changing them in one project affects other sessions and projects loading GOAT against that database. A new workspace does not reset GOAT to OFF. Separate host databases have separate settings. The picker does not edit `opencode.json` or store OAuth tokens.

## Modes, roles and parallel work

**Standard** keeps the user's ordered plan, or starts from one objective. It does not invent a list of implementation steps. **Resink** allows the Manager to propose steps when no user plan exists; a supplied plan takes priority. Resink is supported by the decision layer and the existing provisioned project profile. Ordinary workspace execution requires Standard.

The core preserves `OriginalIntent` (the exact instruction, constraints and acceptance criteria). Tiers describe **capability**, not professions or permissions:

| Role | What to look for |
|---|---|
| Manager | Planning, reasoning, delegation and routing. Choose a model that can discover files and propose a narrow scope. |
| L1 | Inexpensive, fast tool use for straightforward edits. |
| L2 | Capable coding and debugging for changes needing more context. |
| L3 | Strong reasoning and complex implementation, including bounded escalation. |
| Auditor | Strong independent verification and critical reasoning; evaluates test evidence rather than trusting a Worker report. |

The dynamic Worker pool starts only tasks whose dependencies have completed. In Standard, multiple objectives follow the user's order unless the request authorizes independent work. Conflicting scopes are rejected. Up to four tasks can share a run, with at most three Workers active at once. Request budgets are shared, not multiplied per Worker. A reproducible defect can trigger one bounded rework round, including affected dependents. A failed audit is not permission to write.

### Example model assignments

Suggestions as of **28 November 2026**. These model IDs and tool support were checked in the [public model catalog](https://models.dev/); your OpenCode picker is authoritative for your account. They are starting points, **not benchmarks or cost-saving claims**. In the table, GPT models are under `openai`, Claude models under `anthropic`.

| Example | Manager | L1 | L2 | L3 | Auditor |
|---|---|---|---|---|---|
| Budget | gpt-5.4-mini | gpt-5.4-nano | gpt-5.4-mini | gpt-5.4 | claude-sonnet-4-6 |
| Balanced | gpt-5.4 | gpt-5.4-mini | claude-sonnet-4-6 | gpt-5.4 | claude-opus-4-7 |
| Performance | gpt-6.1-sol | gpt-5.4-mini | gpt-5.4 | gpt-6.1-sol | claude-opus-4-7 |

All assignments are manual. One provider is enough if it offers distinct suitable models. Inverting tiers can spend more on simple work and send escalation to a weaker model. A weak Auditor may miss a defect or reject a valid change. A second model is not proof of correctness. Missing, disabled or incompatible assignments can block execution; GOAT does not rank models or silently substitute another.

## Example: repair a calculator

In a project with `src/calc.py` and an existing `test_calc.py`, ask: **“Fix the calculator so it passes its existing tests. Do not change the tests.”** The Manager can discover the paths with native `glob` and `read`. Review `goat_workspace`: the implementation should be writable, the suite read-only. Workers edit staging; the Auditor reviews the evidence. On `goat_apply`, check the exact targets before granting permission.

Look for `checksPassed: true`, `reason: verified_applied`, and `application.applied` containing `src/calc.py`. Passing tests in staging alone does not mean your checkout changed. If `conflicts`, `unapplied` or `uncertain` is non-empty, inspect the files and receipt before retrying.

## Support and trust boundaries

- **Distribution target tested:** native OpenCode **2.4.2** on Linux x86-64, including the terminal in VSCodium. No GUI command registration. Earlier adapter regression coverage on 2.3.2 and 2.4.1 is [documented separately](docs/task-3-opencode-compat.md); the package lifecycle gate targets 2.4.2.
- **Ordinary workspace verifier:** bounded, protected Python `unittest` suites, `/usr/bin/python3`, `/proc`, Landlock ABI ≥3 and `libseccomp.so.2`. OpenCode `glob` needs its ripgrep helper. The helper recognizes Linux x86-64 and aarch64; this package was not tested on ARM. macOS and Windows verified execution/write-back are not supported.
- **Other profiles:** private regression profiles cover deterministic text, a single Python function and signed multi-file Python projects, including parallel schedules. They are not prerequisites for installation. Other text files can be staged; an unsupported suite does not verify a change or authorize write-back.
- Install only trusted plugins in trusted workspaces. A server plugin runs with your user's access. Approved content goes to the selected providers. File limits, restricted tools and secret-pattern checks do not detect every sensitive value. Natural-language scope findings are advisory.
- Verification is evidence for the assigned tests, not a guarantee about every behavior. The Linux write helper rechecks scope and file contents; a multi-file change is not atomic. Unsupported filesystems, changed inputs, cancellation or denied permissions can leave staged or partially applied work. Inspect the receipt; GOAT does not roll back over another editor's changes.

## Troubleshooting

| Symptom | What to check |
|---|---|
| No `/goat` | Use the OpenCode TUI. Check `opencode plugin list` or the configured local package directory, and the server log for the exact `err_…` reference. For Flatpak use `$XDG_DATA_HOME/opencode/log/opencode.log` from that terminal. A server-only client has no TUI slash menu. |
| `Export named 'digest' not found` during development | Rebuild/install **both** packages with `npm run pack:candidate`. The development config points to this installed pair. A long-lived loader can retain unwatched workspace dependencies. If a fresh `opencode --standalone` loads the pair but the shared service is stale, restart that service when idle. No cache or database deletion is required. |
| HTTP error or unavailable model | Check `/goat status`, the host log reference and the active Build provider. Choose enabled, tool-capable Manager/Workers and a different Auditor in `/goat router`. Use a plain top-level Build prompt in Standard. `/goat off` restores ordinary prompting. |
| No verified result | Check the actual tool receipt. A Manager reply without the GOAT tool is not a verification. Check the proposed scope, permission decision, supported suite and host prerequisites. `unsupported` means checkout write-back was not verified. |
| Checks passed but the file is unchanged | Check `application.status` and `detail`. A denied apply or conflicting edit can prevent a write after tests passed. |

## Update and uninstall

For a global registry install, use `opencode plugin check`, then `opencode plugin update @goat/opencode`. For a project pinned to an exact version, change only that entry to the approved version. For local tarballs, install the new matched pair into a **new version directory**, then switch only the GOAT path. OpenCode watches its configuration.

Before removal, use `/goat off` if you want reinstalls to start disabled. For a global registry entry use `opencode plugin remove @goat/opencode` (use the exact configured specifier for a pin). For a project or local directory remove only its GOAT entry; the dedicated candidate directory can then be discarded if no configuration uses it. Unloading a plugin is not a reset of its saved settings. Keep the host database, providers, credentials, MCP entries, other plugins and permissions.

## Further reading

[Architecture](docs/architecture.md) · [Portable core and host boundary](docs/task-6-portable-core.md) · [Workspace verification and write-back](docs/task-5-workspace.md) · [Parallel orchestration](docs/task-4-parallel.md) · [Packaging, development checks, license review and Owner test](docs/task-7-packaging.md) · [Historical milestone reports](docs/)
