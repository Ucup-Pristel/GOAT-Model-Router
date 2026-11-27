# GOAT Model Router for OpenCode

Route approved workspace tasks to manually assigned models and independently
verify staged changes before writing them back. GOAT starts OFF.

After beta publication, install globally with `opencode plugin add @goatmr/opencode@beta`.
The matching core is installed automatically. In the
OpenCode terminal, use `/goat router`, choose Standard in `/goat mode`, then
`/goat on`. Inspect `/goat status`; use `/goat off` to return to native behavior.

Activation, mode and model selections are shared across workspaces using the
same OpenCode database. Tested with OpenCode 2.4.2 on Linux x86-64.

[Installation, support and trust boundaries](https://github.com/Ucup-Pristel/GOAT-Model-Router#readme).
Licensed under [Apache-2.0](LICENSE); see [NOTICE](NOTICE).
