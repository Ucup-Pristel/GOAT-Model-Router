# GOAT Model Router

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

GOAT lets one OpenCode Build session delegate scoped analysis or implementation to capability-tier Workers and ask an independent Auditor to check the evidence. Verified edits require protected checks and permission **before changing your checkout**; read-only findings return without a write gate. GOAT starts **OFF**.

This development branch includes the unreleased [runtime compatibility patch](docs/runtime-compatibility-patch.md). The published baseline remains `0.1.0-beta.1`.

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

**Public beta: `0.1.0-beta.1`**. These registry instructions apply once the `beta` tag is published. See the [release notes](docs/releases/v0.1.0-beta.1.md) for the supported host and known limitations.

| Where to load GOAT | Native installation after publication |
|---|---|
| All your OpenCode projects | Run `opencode plugin add @goatmr/opencode@beta`. OpenCode installs the matching core and adds the plugin to your user configuration. |
| Just one project | Append `"@goatmr/opencode@0.1.0-beta.1"` to `plugins` in that project's `opencode.json(c)` or `.opencode/opencode.json(c)`. OpenCode resolves it for that project and its descendants. |

Choose one installation scope. For a project without a `plugins` field, add it as an array containing the entry above. Keep your existing settings and plugin entries. OpenCode loads the server, TUI and RPC parts together; no source checkout, build, separate core install or provider gateway is needed. Run `/goat status` in the terminal UI to check the installation.

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

If your prompt contains multiple objectives, state which may run independently; otherwise Standard preserves their order. See [orchestration](docs/orchestration.md) for task limits, file conflicts and rework.

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

- **Distribution target tested:** native OpenCode **2.4.2** on Linux x86-64, including the terminal in VSCodium. No GUI command registration. See [compatibility](docs/compatibility.md) for earlier adapter regression coverage on 2.3.2 and 2.4.1.
- **Workspace profiles:** protected Python unittest, isolated Node/TypeScript/Rust checks, documentation/JSON inspection, and audited read-only analysis. Command checks require Linux bubblewrap, a resource-controlled systemd user scope and installed toolchains; Python retains its Landlock/seccomp sandbox. See [verification](docs/verification.md) for exact supported commands and evidence semantics. Unsupported verification cannot authorize write-back.
- **Native tools/MCP:** snapshot-scoped discovery, protected editing, and exact operator-approved external read grants. MCP servers need independently enforced scope; GOAT cannot sandbox an arbitrary remote service. See [compatibility](docs/compatibility.md#native-tools-and-mcp).
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

For a global beta install:

```sh
opencode plugin check
opencode plugin update @goatmr/opencode@beta
```

To uninstall globally, run `opencode plugin remove @goatmr/opencode@beta`. For a project-local pin, edit only the GOAT version to update, or remove only that entry to uninstall. OpenCode watches its configuration. Uninstalling retains GOAT's shared settings: use `/goat off` before removal if you want reinstalls to start disabled.

## License and acknowledgments

GOAT is licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE).
The adapter uses [OpenCode](https://opencode.ai/) for model connections, permissions and plugin storage. The build uses TypeScript; workspace checks use Python and the host's Linux sandbox facilities, including libseccomp.

## Further reading

[Architecture](docs/architecture.md) · [Orchestration](docs/orchestration.md) · [Verification](docs/verification.md) · [Compatibility](docs/compatibility.md) · [Roadmap](docs/roadmap.md)

[Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)
