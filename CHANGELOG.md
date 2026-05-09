# Changelog

## 0.1.2 — 2026-05-10

Agent-UX patch release. No spec amendment, no public API changes — just rewrites the strings agents actually read and enriches the path-rejection error envelope.

### Changed
- **Tool descriptions rewritten** for `http_request`, `http_read`, `http_inspect`. Now lead with the recommended default flow (http_request → schema + cache_id → http_read with a jq mask) instead of describing the parameter surface. `http_request` adds explicit cost framing on `include_body: true` (200KB JSON ≈ 12K tokens), a chunked-multipart compatibility note, and a 2-example mini-cookbook (unknown-endpoint exploration + GitHub-issues sort/slice). Triggered by real agent feedback where the boolean form of `include_body` consistently biased agents toward `true`.
- **Path-rejection error envelope is richer.** `error.detail` on `ensureUnderRoot` failures now carries `field`, `value` (original input), `resolved` (`path.resolve(value)` so traversal attempts surface), `root`, `runtime` (`'docker'` or `'host'`), and `hint` (runtime-specific guidance). Lets agents (and humans) self-correct on rejected paths without guessing.

### Added
- **README "Run modes & file paths"** section. Decision table for picking npx / Docker / remote MCP, an explicit per-runtime matrix for where `multipart.files[].path` / `download_to` / `save_to` resolve, and a note on multipart chunked-transfer compatibility (most servers fine; legacy proxies may reject).
- **README "Default flow" callout** above the Tools table, mirroring the rewritten tool descriptions to reduce drift between in-tool docs and README.

## 0.1.1 — 2026-05-10

### Fixed
- Server failed to start when launched through a symlink (npx, `npm install -g`, or any package-manager bin shim). The entrypoint guard compared `import.meta.url` to a literal `file://` + `process.argv[1]`, which differed from the resolved real path under a symlink, so the bootstrap branch was skipped and the process exited silently with code 0. Now resolves `argv[1]` via `realpathSync` + `pathToFileURL` before comparing.

## 0.1.0 — 2026-05-09

Initial release.

### Added
- `http_request`, `http_read`, `http_inspect` MCP tools.
- All HTTP methods. Body input as object, raw, or multipart.
- Four schema formats: `paths` (default), `shape`, `sample`, `json_schema`.
- jq filtering via `jq-wasm` (with `MAGPIE_USE_NATIVE_JQ` env-toggle reserved for future native fallback).
- In-memory cache with 10-minute TTL.
- `download_to` for streaming binary responses straight to disk (sha256 computed inline).
- Configurable via `MAGPIE_*` env vars (timeouts, size caps, schema depth/key limits, TLS).
- `MAGPIE_FILES_ROOT` env: when set, restricts `multipart.files[].path`, `download_to`, and `save_to` to canonical paths under this prefix; surfaces the constraint in tool descriptions for the agent. Unset = no constraint (npm-mode default).
- Unified error envelope with stable `kind` codes.
- npm + Docker (alpine multistage) distribution. Recommended Docker pattern is a same-path bind mount paired with `MAGPIE_FILES_ROOT` — agent paths "just work" without host↔container translation.
- CI on Node 20 / 22 with docker smoke job.
