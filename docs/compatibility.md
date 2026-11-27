# OpenCode compatibility

The public beta installation target is **OpenCode 2.4.2, Linux x86-64, terminal UI**. The [package lifecycle test](../tests/milestone/packaging.test.mjs) exercises global install, update, removal and project-local loading. The adapter has no desktop GUI commands.

Earlier regression tests exercised the single-file Python coding profile against three native host versions using a local mock provider:

| OpenCode version | Earlier milestone tests (pass / fail / skip) | Protected checks after one rework | TUI controls without model requests |
|---|---:|---:|---|
| 2.3.2 | 120 / 0 / 10 | 4/4 | Passed |
| 2.4.1 | 120 / 0 / 10 | 4/4 | Passed |
| 2.4.2 | 120 / 0 / 10 | 4/4 | Passed |

These results cover plugin loading, RPC, model selection, ordinary Build prompts and child sessions. They do not establish beta package lifecycle support on the two earlier hosts. The development SDK is pinned to `@opencode/plugin@2.3.2`; the running host supplies the plugin API.

## Workspace verifier

Verified workspace write-back supports bounded Python `unittest` suites. It requires `/usr/bin/python3`, `/proc`, Landlock ABI ≥3 and `libseccomp.so.2`; native `glob` discovery also needs OpenCode's ripgrep helper. The Linux helper recognizes aarch64, but the beta package was not tested on ARM. macOS and Windows verified write-back are unsupported.

GOAT can stage other text files. Without a supported protected suite, the changes cannot be applied to the checkout. See [verification](verification.md) for receipt fields and filesystem limits, and the [README](../README.md#install) for installation.
