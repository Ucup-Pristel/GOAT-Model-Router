# Task 1A preflight evidence

Date: 2026-11-19. OpenCode v2.3.2; Node 22.23.5 selected using existing nvm installation. System default remains Node 20.20.2. `@opencode/plugin@2.3.2` package has no `engines` entry, but transitive `@effect/opentelemetry@4.1.0` declares `node >=22.19.0`; project uses Node 22.23.5.

## Host tests

> Historical note: the registry/dispatch bullets below describe Task 1A before the RPC architecture was verified. They are retained as history and are superseded by the Task 1B/1C sections.

- Initial test path `/tmp/opencode/goat-preflight/.opencode/plugins/goat` was a symlink. Host log confirmed `inotify_add_watch ... failed: Not a directory`. Fixed harness by copying plugin files to a real directory.
- Official local discovery uses `<project>/.opencode/plugins/<plugin>/package.json`, with `exports` for server (`.`) and TUI (`./tui`). Current `packages/opencode/package.json` declares both and exact SDK `@opencode/plugin@2.3.2` runtime dependency.
- Isolated `opencode --standalone run 'Reply OK.'` on Node 22.23.5 starts and returns OK. Logs show plugin entrypoint loading, `command.updated`, and no loader/initialization error for tested bootstrap revisions. No AI model request was caused by plugin setup or TUI probe; CLI smoke prompt itself did invoke configured model and is not evidence for a no-model test.
- `opencode --standalone` interactive TUI capture shows `/goat <args>` suggestion and `GOAT integration menu` dialog; input args appear in the dialog option. Capture: `/tmp/opencode/goat-final-tui.log` (ephemeral, not checked in). Earlier menu revision exposed `GOAT integration probe` palette action and toast; removed to avoid creating extra public command.
- Server commands registry/API attempt used isolated `opencode --standalone api command.list` and `plugin.list`; both returned empty arrays, despite `command.updated` event. No server `/goat status` execution was proven. Therefore server plugin/command active state is **not verified**. Do not treat load logs as PASS.
- API list returned empty because V2 runtime registry/API behavior is unresolved; no upstream bug claim established. Local API client likely selected a location with no activated server because API command ran outside the TUI-owning runtime. Need reproduce using authenticated API client attached to exact running server and same location, then inspect `ctx.plugin.list()`/`ctx.command.list()` from plugin setup or TUI client.
- TUI slash command is kept separate from server `/goat` command. The temporary probe demonstrated user-visible TUI callback but was removed; server `/goat` dispatcher is not verified. Exactly five commands remain the intended product surface; no extra slash command was added.

## Gate update — Task 1B

Task 1A initially failed because host checks used location-omitted/wrongly encoded API requests, and auto-discovery was mixed with an explicit plugin location. Official RPC documentation shows the TUI owns its slash command and calls server RPC via `context.client.rpc(Contract)`; a second server command transform is unnecessary for this slash surface. Server RPC requires its own server plugin loaded for the same location.

Task 1B isolated test now uses `opencode.jsonc` with explicit `plugins: ["./.opencode/plugins/goat"]`, real copied plugin directory, temporary HOME/XDG paths, Node 22.23.5, and `opencode --standalone`. The actual `/goat task1b-proof` TUI callback calls `goat.health` with exact location. Captured dialog shows `goat.model-router active=true handled=true protocol=1 requestID=<uuid>` then `GOAT RPC verified`. The health handler is read-only and echoes the request ID; no model call is performed by this interaction. `opencode --standalone run 'Reply OK.'` was used only for loader startup and did perform the configured model invocation; it is not the no-model evidence. API `/api/plugin`/`/api/command` lists had omitted or incorrectly encoded location in earlier attempts, so their empty arrays described a different/default location and do not contradict this exact-location RPC proof.

Gate passes for TUI→RPC→server. Final interactive command uses a single `/goat` TUI slash command; subcommands route over the typed RPC contract. No parallel server prompt command is registered. Task 1 configuration/control work is implemented; independent final Task 1 auditor still required.

## Task 1C — RPC schema regression fixed and final host evidence

### Root cause

`getConfig` was declared with an envelope output (`{ config: GoatConfig }`), and the TUI read `const { config } = await goat.getConfig(...)`. During the incremental implementation, the server handler still returned the bare `GoatConfig` object. The transport therefore returned:

```text
{"type":"rpc.invalid_output","message":"Missing key at [\"config\"]"}
```

This was a real contract mismatch, not a serialization issue. The schema was not weakened. The handler was corrected in `packages/opencode/src/index.ts` to return `{ config: validateConfig(...) }`; the declared output schema in `packages/opencode/src/rpc.ts` already required `config`. A fresh copy of the plugin at `/tmp/opencode/goat-rpc-test/.opencode/plugins/goat` reproduces the success path; the prior failure came from testing an older copied handler before that wrapper was applied.

### Fix and regression guard

- `packages/opencode/src/index.ts`: `getConfig` now returns the declared envelope; `setConfig` also returns an envelope. `setConfig` requires plain objects and rejects arrays, non-plain objects (`Date`, `Map`, `Set`, inherited prototypes), unknown top-level keys, unknown roles, malformed model refs, and model refs with extra fields instead of silently normalizing them. Invalid config is never persisted.
- `packages/opencode/src/tui.ts`: reads `{ config }`; RPC errors are formatted from `message`/`type`/`cause` instead of `[object Object]`; arguments are trimmed before dispatch, so `/goat router ` opens the picker while `/goat router <model>` is rejected.
- `packages/opencode/test/control.test.ts`: validates handler output against the actual `Goat.methods.getConfig.output` JSON schema and asserts that a bare config fails with `Missing key at $.config`. This test fails on the original bug. A second regression test rejects malformed `setConfig` shapes (`models: []`, `Date`, inherited prototype, unknown role, missing `modelID`, unknown top-level key), asserts nothing is persisted, then verifies a valid plain-object config still saves.
- `npm run check` and `npm test`: **PASS**, 7/7 tests under Node 22.23.5.

### Real isolated host verification

Environment: `opencode v2.3.2`, Node 22.23.5, isolated `HOME=/tmp/opencode/goat-home`, `XDG_CONFIG_HOME=/tmp/opencode/goat-xdg`, `OPENCODE_CONFIG=/tmp/opencode/goat-rpc-test/opencode.jsonc`, plugin explicitly configured as `./.opencode/plugins/goat`, real copied plugin directory. Captures are ephemeral: `/tmp/opencode/goat-1c-final-host.raw`, `/tmp/opencode/goat-1c-final-*.txt`, `/tmp/opencode/goat-1c-final-restart.raw`.

Verified in the actual TUI and server:

- Server plugin loaded from the isolated entrypoint; TUI plugin loaded from `src/tui.ts`; no loader failure.
- `/goat router`: Model picker opened and saved explicit Manager plus L1/L2/L3/Auditor assignments. Result: Manager `opencode/deepseek-v4.1-flash-free`; L1/L2/L3/Auditor `opencode/tidepool-alpha-free`.
- `/goat mode standard` then `/goat mode resink`: status changed `Mode: standard` → `Mode: resink`.
- `/goat on`: status `Enabled: true`.
- `/goat off`: status `Enabled: false`.
- Restart with the same isolated HOME: `/goat status` still reported OFF, Resink, same Manager and tier assignments. Plugin storage value confirmed as:
  `{"version":1,"enabled":false,"mode":"resink","inheritManagerModel":false,"models":{"manager":{...},"l1":{...},"l2":{...},"l3":{...},"auditor":{...}}}`
- No `rpc.invalid_output`, `failed to load plugin`, or `session.execution` event appears in the final run. In this reused environment the session count stayed at 16 before and after the control sequence; the later fresh-DB runs recorded below started and ended at 0. The plugin performs no model generation or orchestration while OFF; status and router only read model/provider inventory.

### Post-audit hardening verification (fresh HOME/DB)

After the first Task 1C audit, validation and parsing were hardened, including the final plain-object guard, and the host flow was rerun with a completely fresh isolated environment: `HOME=/tmp/opencode/goat-1e-home`, `XDG_CONFIG_HOME=/tmp/opencode/goat-1e-xdg`, project `/tmp/opencode/goat-1e-test`, new SQLite database, current byte-copied plugin (SHA-256 of `index.ts`/`rpc.ts`/`tui.ts` matched the repository). No old process or database was reused. Captures: `/tmp/opencode/goat-1e-host.raw`, `/tmp/opencode/goat-1e-*.txt`, `/tmp/opencode/goat-1e-restart.raw`.

- Initial `/goat status`: OFF, Standard, Manager inherit, all tiers unconfigured.
- `/goat router ` (with trailing space): picker opened. Manager set to inherit; L1/L2/L3/Auditor saved. Status showed Manager inherit and the four configured tiers.
- A second router run selected an explicit Manager, then cancelled with Escape at L1. Status after cancellation was identical to before (Manager still inherit, same tiers), demonstrating no partial save.
- A full router run saved explicit Manager `opencode/deepseek-v4.1-flash-free` and tiers `opencode/tidepool-alpha-free`.
- `/goat mode standard` then Resink saved; subsequent status showed Resink. `/goat on` then `/goat off` changed status to enabled then disabled.
- Restart with the same isolated HOME: status still OFF, Resink, same role assignments. SQLite KV config matched.
- `session_v2` count was **0** during the control sequence and **0** after restart. Logs show plugin loading from the isolated entrypoint and no `failed to load plugin`, `rpc.invalid_output`, `session.execution`, or ERROR entry.

### Limitations

- The final host test intentionally does not send a normal model prompt, to honor the no-model-request restriction. Native prompt behavior is preserved by construction: the plugin registers only a TUI slash command and RPC handlers, with no prompt hooks or interceptors.
- Model availability is checked at save time; a model removed later is reported as `(unavailable)` in status. Malformed RPC writes are rejected; malformed already-stored values fall back to defaults on read.
- Interactive terminal captures were collected with a screen-emulating test driver because the TUI redraws labels incrementally. The checked-in automated tests cover configuration, RPC schema, and persistence behavior; host captures are evidence artifacts, not committed fixtures.
- There is no automated TUI-level test for slash registration, router cancellation/all-or-nothing save, or Manager inheritance; those paths were exercised manually in the fresh host run above.

## Dependency review

Audit at Task 1A: 24 moderate, 0 high/critical. Full advisory names, versions, paths and reachability review from independent dependency auditor is summarized below; detailed raw npm output was captured under `/tmp/opencode/` and is not a credential-bearing artifact.

All advisories enter through `@opencode/plugin@2.3.2 -> @opencode/util@2.3.2`, or `@opencode/plugin -> @opencode/ai -> google-auth-library -> gcp-metadata/gaxios`; the latter nested path also contains `rimraf -> glob/minimatch`. GOAT itself only imports plugin APIs and does not call npm package tooling, glob/minimatch, registry, TUF/Sigstore, Google metadata/auth, or deletion utilities. This lowers apparent reachability for current commands; it does not prove SDK dependency code unreachable. Because runtime package installs this SDK, these are runtime dependency-tree advisories even though root SDK is also a dev dependency.

| Package(s) | Path (root) | Fix available | Actual GOAT reachability / residual risk |
|---|---|---:|---|
| `@npmcli/arborist`, `@npmcli/config`, `@npmcli/map-workspaces`, `@npmcli/metavuln-calculator`, `@npmcli/package-json`, `@npmcli/run-script` | plugin → util → npm tooling | Yes | GOAT does not run npm tooling; residual SDK internal reachability. |
| `cacache`, `ignore-walk`, `npm-packlist`, `npm-registry-fetch`, `pacote`, `make-fetch-happen` | plugin → util → pacote/arborist | Yes | No package retrieval/cache/listing used by GOAT; registry inputs not passed. |
| `@sigstore/sign`, `@sigstore/tuf`, `@tufjs/models`, `sigstore`, `tuf-js` | plugin → util → pacote → sigstore/TUF | Yes | No signing, verification, or TUF actions called. |
| `glob` | plugin → util/npm tree; plugin → ai → google-auth → gcp-metadata → gaxios → rimraf → glob | No automatic fix reported | No GOAT glob use; advisory cancellation bypass remains in SDK dependency tree. |
| `minimatch` | plugin → util/npm tree; nested through gaxios/rimraf | No automatic fix reported | No GOAT pattern matching; DoS advisory remains; reported fix requires minimatch 11.0.1+, avoid override across major. |
| `gaxios`, `gcp-metadata` | plugin → `@opencode/ai` → Google auth/metadata | Yes | No GOAT provider credential access or metadata call; SDK provider internals residual. |
| `@opencode/plugin`, `@opencode/util` | direct SDK / transitive util | No automatic fix reported | Required SDK APIs used; no safe SDK upgrade identified. Residual risk within SDK dependency graph. |
| `rimraf` | plugin → AI/auth → metadata → gaxios → rimraf | Yes | GOAT does not invoke deletion helper. |

No override or force-upgrade applied. `npm audit --omit=dev` still reports all 24, because the runtime package depends on SDK. Remediation requires compatible SDK update or upstream transitive fixes, followed by isolated host tests.

## Task 1 dependency audit detail

Independent audit found 24 moderate, no high/critical. Every audited package is in the SDK runtime dependency graph for the plugin tarball (root SDK also listed under devDependencies). Current GOAT code paths do not call affected npm tooling, glob matching, npm registry, TUF/Sigstore, Google auth/metadata, or deletion utilities. This is practical reachability analysis, not proof that SDK internals never reach them. For every entry below, `fix=true` means npm audit reports a compatible remediation; update only through compatible SDK/transitive releases and rerun host tests. `fix=false` means no safe automatic remediation reported.

| Package (installed) | Dependency path | Fix | Runtime relevance / residual risk |
|---|---|---:|---|
| `@npmcli/arborist@9.4.0` | plugin → util → arborist | yes | npm internals unused by GOAT; residual SDK utility path. |
| `@npmcli/config@10.8.1` | plugin → util → config | yes | npm config not used by GOAT. |
| `@npmcli/map-workspaces@5.0.3` | plugin → util → arborist/config → map-workspaces | yes | workspace mapping not used. |
| `@npmcli/metavuln-calculator@9.0.3` | plugin → util → arborist → metavuln-calculator | yes | npm audit calculations not used. |
| `@npmcli/package-json@7.0.5` | plugin → util → arborist/pacote → package-json | yes | GOAT does not inspect package metadata. |
| `@npmcli/run-script@10.0.4` | plugin → util → arborist/pacote → run-script | yes | GOAT does not run package scripts. |
| `@opencode/plugin@2.3.2` | direct runtime dependency of plugin package | no | required SDK surface; no direct GOAT invocation of flagged utility found. SDK code exposure remains. |
| `@opencode/util@2.3.2` | plugin → util | no | contains vulnerable npm graph; GOAT does not call those features. |
| `@sigstore/sign@4.1.1` | plugin → util → pacote → sigstore → sign | yes | no package-signing invocation. |
| `@sigstore/tuf@4.0.2` | plugin → util → pacote → sigstore → tuf | yes | no TUF call. |
| `@tufjs/models@4.1.0` | plugin → util → pacote → sigstore → tuf-js → models | yes | no TUF metadata parsing by GOAT. |
| `cacache@20.0.4` | plugin → util → npm internals → cacache | yes | npm cache not used by GOAT. |
| `gaxios@7.1.3` | plugin → ai → Google auth → gcp-metadata → gaxios → rimraf | yes | GOAT does not invoke Google metadata/auth. |
| `gcp-metadata@8.1.4` | plugin → ai → Google auth → metadata | yes | no metadata call in GOAT. |
| `glob@13.0.5` / nested `10.5.0` | plugin → util/npm internals; plugin → ai/auth → gaxios → rimraf → glob | no | no GOAT globbing. SDK-internal filesystem utility reachability unknown. |
| `ignore-walk@8.0.0` | plugin → util → npm-packlist → ignore-walk | yes | no package file-walking use. |
| `make-fetch-happen@15.0.6` | plugin → util → npm registry/TUF paths | yes | GOAT does not fetch registries/TUF. |
| `minimatch@10.2.5` / nested `9.0.9` | plugin → util/glob; nested via gaxios/rimraf | no | no pattern matching by GOAT; DoS remains in tree. Fixed release requires 11.0.1+, avoid override major. |
| `npm-packlist@10.0.4` | plugin → util → pacote → npm-packlist | yes | no package packing by GOAT. |
| `npm-registry-fetch@19.1.1` | plugin → util → pacote → registry-fetch | yes | not used in GOAT task path. |
| `pacote@21.5.1` | plugin → util → arborist → pacote | yes | package retrieval not used. |
| `rimraf@5.0.10` | plugin → ai/auth → metadata → gaxios → rimraf | yes | deletion helper not called by GOAT. |
| `sigstore@4.1.1` | plugin → util → pacote → sigstore | yes | not used. |
| `tuf-js@4.1.0` | plugin → util → pacote → sigstore → tuf-js | yes | not used. |

No dependency overrides, `npm audit fix`, or forced major upgrades applied. Residual SDK dependency risks remain documented.
