# Contributing

Use a GitHub issue to describe a bug or propose a change. For sensitive reports, follow [SECURITY.md](SECURITY.md). Include the OpenCode version, OS, installation scope and a small reproduction using synthetic data.

For development, use Linux, Node.js ≥22.19 and npm ≥10. The native milestone tests target OpenCode 2.4.2 (`opencode` on `PATH`), Git, `tar`, ripgrep, `/usr/bin/python3`, Landlock ABI ≥3 and `libseccomp.so.2`.

```sh
npm ci
npm run check
npm test
npm run audit:milestone
```

`npm ci` builds and installs the development tarballs referenced by this checkout's `opencode.json`. Run `npm run pack:candidate` after changing source to refresh them. The milestone suite rebuilds them and uses isolated hosts and mock providers; it needs no real provider credentials.

Keep host-independent decisions in `packages/core` and OpenCode APIs, permissions and workspace operations in `packages/opencode`. In a pull request, explain the user-visible change, tests run and any compatibility limits. Preserve license and attribution notices; submit only material you have the right to contribute under [Apache-2.0](LICENSE).
