# Changelog

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
