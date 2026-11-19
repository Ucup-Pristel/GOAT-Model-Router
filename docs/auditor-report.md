# Independent Auditor reports

Review performed read-only by an independent Auditor on 2026-11-19. This file records each verdict in order; later sections supersede earlier blocking findings.

## Task 1C — PASS (current, re-audited after hardening)

**Task 1C result: PASS.** The `getConfig` RPC envelope regression is genuinely fixed and covered by a regression test. The current plugin build, fresh isolated-host flow, persisted SQLite state, and restart behavior are consistent. No Task 1C blocker remains.

### Independently verified

- Node `22.23.5`; `npm run check` clean; Task 1 suite **7/7 pass, 0 fail** at the time. (The first audit ran 6/6 before the validation regression test was added; the re-audit verified 7/7. The repository-wide suite at the Task 2 audit was 41/41; the current suite is documented in `docs/task-2-manager.md`.)
- `packages/opencode/src/index.ts` returns `{ config: ... }`; `packages/opencode/src/rpc.ts` requires `config`; the regression test validates handler output against the real output schema and asserts a bare config fails with `Missing key at $.config`.
- Exactly one TUI slash definition (`/goat`) with exactly five verbs; no duplicate server prompt command, prompt hook, or session/model generation path.
- Typed RPC via `Rpc.define` and `context.client.rpc(Goat)`.
- Fresh isolated host (`/tmp/opencode/goat-1e-test`, new HOME/XDG/SQLite DB): `/goat router ` with trailing space opened the picker; Manager inherit saved and displayed; cancel at L1 left status unchanged (no partial save); explicit Manager/tier save worked; Standard and Resink were saved (subsequent status showed Resink); ON and OFF changed status to enabled then disabled.
- Restart with the same isolated HOME preserved OFF, Resink, Manager `opencode/deepseek-v4.1-flash-free`, and tiers `opencode/tidepool-alpha-free`; SQLite KV config matched.
- 1E host log: 0 ERROR/WARN, 0 `failed to load plugin`, 0 `rpc.invalid_output`, 0 `session.execution`; `session_v2=0` and `session_message=0` before and after, including restart. Only two HTTP 200 `/api/event` entries.
- Packaging dry-run: 4 files, 3.4 kB, no tarball. Dependency audit: 24 moderate, 0 high, 0 critical; SDK pinned `2.3.2`; no overrides or forced upgrades. Isolated config; no publish/push/deploy.

### Findings and disposition

- **Medium, fixed:** `setConfig` normalized malformed `models` (for example `models: []` or unknown role `l4`) instead of rejecting it. The RPC boundary now requires plain objects and rejects arrays, non-plain objects (`Date`, `Map`, `Set`, inherited prototypes), unknown top-level keys, wrong primitive types, unknown roles, and malformed/extra model-ref fields before persistence. The re-audit independently probed these shapes with `setCalls=0`. Regression test: `setConfig rejects malformed shapes instead of silently normalizing`. `getConfig` still safely falls back to defaults for malformed stored values; that is read-path sanitization, not silent acceptance of a write.
- **Low, fixed:** stale Task 1A FAIL text in this file. Historical verdicts are now explicitly separated from the current Task 1C PASS.
- **Low, fixed:** `/goat router ` with a trailing space showed the CLI-rejection message. Argument parsing trims first and rejects only non-empty extra arguments; the 1E host capture shows the picker opening for the trailing-space command.
- **Low, resolved after Task 1C:** the Project Owner approved a local baseline commit. `dde15b6` now contains the verified Task 1 state; Task 2 changes are uncommitted working-tree changes. No publish/push occurred.

### Residual evidence gaps

- No automated TUI-level test for slash registration, trailing-space parsing, router cancellation/all-or-nothing save, or Manager inheritance. These paths are covered by the 1E host captures and code review; `/goat router foo` rejection is code-verified, not separately host-captured.
- Successful TUI RPC calls use the stdio client and do not appear as `/api/rpc` HTTP log entries. Success evidence is the TUI dialogs, the SQLite config update at `2026-11-19T01:17:33.410Z`, and the restart capture.
- A stale preflight host (`PID 89067`) still runs under the old `/tmp/opencode/goat-home`. The 1E run used a different HOME/DB/project; no process uses the 1E paths, so the fresh evidence is uncontaminated.
- Host captures live under `/tmp/opencode` and are ephemeral fixtures. The `@goat/opencode` tarball depends on `@goat/core` rather than bundling it; packaging is not self-contained yet.
- 24 moderate dependency advisories remain in the pinned SDK tree. No Task 1C blocker; review before release.

## Task 1A — FAIL / blocked (historical, superseded)

The Task 1A review found no verified active server plugin API or actual `/goat status` dispatch. TUI dialog was separately demonstrated but did not validate the server command path. Task 1B later proved TUI→RPC→server connectivity and Task 1C closed the envelope regression.

## Task 0 — PASS with one finding fixed (historical)

### Finding and disposition

- **High, fixed:** `@goat/opencode` imported `@opencode/plugin` but did not declare it as a runtime dependency. Added exact compatible SDK dependency `2.3.2` and restricted package files to `src` in `packages/opencode/package.json`. Lockfile refreshed. Re-run package dry-run and tests after this correction.

### Verified

- TypeScript check and initial test suite passed before dependency correction; rerun evidence recorded in final report.
- Bootstrap test checks command registration and OFF response without model calls.
- No routing, workers, audit model, state persistence, or global configuration changes.
- Official V2 docs support SDK entry point, server command transform, invocation fields, and synthetic response API.
- README states host smoke test remains unverified.

### Limitation (historical)

No compatible OpenCode V2 host was available at Task 0 time. That gap was later closed by Task 1B/1C isolated-host testing.
