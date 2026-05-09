# Changelog

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
- Unified error envelope with stable `kind` codes.
- npm + Docker (alpine multistage) distribution.
- CI on Node 20 / 22 with docker smoke job.
