# Changelog

## 0.2.0 — 2026-05-10

Agent-UX bundle. Breaks the public API on one parameter (`include_body` → `body_mode`). Zero migration cost in practice (no installed v0.1.x users this early), so we took the rename window before usage solidifies. Adds three orthogonal capabilities (`head` mode preview, `next_step_hints`, `server_info` debug tool) plus the `content_base64` multipart payload mode that closes remote-MCP file asymmetry. Pre-bundle hardening pass closes 16 issues from the Copilot audit (header injection, cache_id randomness, symlink-resolved path validation, redirect method downgrade, more).

### Breaking
- **`include_body` is removed.** Use `body_mode: "auto" | "schema" | "head" | "inline"` (default `"auto"`). Sending the legacy field returns `error.kind = "unsupported_field"` with a migration hint. Mapping: `true → "inline"`, `false → "schema"`, `"auto" → "auto"`.
- **`meta.body_included: boolean` is replaced by `meta.body_inclusion`** with `resolved_mode`, `inline_threshold_bytes`, `head_preview_threshold_bytes`, `head_preview_items`, `head_preview_string_chars`, `inline_cap_bytes`, optional `reason`. Lets agents introspect what `auto` actually picked.

### Added
- **`body_mode: "head"`** — schema + `body_preview` with arrays/strings truncated and sibling `_truncated` markers. `auto` upgrades through head between `MAGPIE_INLINE_THRESHOLD_BYTES` and `MAGPIE_HEAD_PREVIEW_THRESHOLD`.
- **`next_step_hints`** — advisory jq-mask suggestions inferred from top-level shape (per spec §5.6). Server proposes; agent picks; server doesn't run them.
- **`server_info` tool** — new 4th MCP tool. No params. Returns `version`, `runtime` (`npx` / `docker` / `unknown`), `cwd`, `files_root`, and a 15-field `effective_limits` object. Use it when a path is rejected unexpectedly or to confirm runtime.
- **`multipart.files[].content_base64`** — alternative file payload mode. The bytes travel inline in the JSON-RPC frame, capped by `MAGPIE_MAX_INLINE_FILE_BYTES` (default 10 MB). Recommended for remote-MCP scenarios where path semantics differ between agent and server. `MAGPIE_FILES_ROOT` does not apply (no path).
- **New error kinds** — `body_too_large_for_inline` (with `cache_id` in `detail` so agent can pivot to `http_read`), `unsupported_field`.
- **New env vars** — `MAGPIE_HEAD_PREVIEW_THRESHOLD` (64 KB), `MAGPIE_HEAD_PREVIEW_ITEMS` (5), `MAGPIE_HEAD_PREVIEW_STRING` (200), `MAGPIE_INLINE_BODY_CAP` (256 KB), `MAGPIE_MAX_INLINE_FILE_BYTES` (10 MB). `MAGPIE_AUTO_INCLUDE_BODY_BYTES` is **renamed** to `MAGPIE_INLINE_THRESHOLD_BYTES` (same default 8192).

### Hardening (pre-bundle Copilot audit pass)
- **Multipart header injection** — CR/LF/NUL in user-controlled header positions (field name, filename, content_type) is now rejected with `invalid_input`; backslash and double-quote in name/filename are RFC 7578 escaped. Validation eager (fails fast on `buildMultipart` call).
- **`cache_id`** — now `crypto.randomBytes(16)` hex (128 bits) instead of `Math.random()`.
- **Symlink escape** — `ensureUnderRoot` resolves through `realpathSync` first (lexical fallback for non-existent paths) so symlinks can't escape `MAGPIE_FILES_ROOT`.
- **`isUnderRoot` root='/'** — prior `rr + sep` produced `'//'` and rejected every absolute path; short-circuit added.
- **Redirect 301/302/303** — downgrade unsafe methods to GET, drop body and content-* headers (RFC 7231 §6.4). 307/308 preserve.
- **Header case-sensitivity** — incoming headers normalised to lowercase to avoid duplicate Content-Type when caller passes mixed case.
- **download_to backpressure** — `stream.write` return value honoured (await `'drain'`); error listener attached.
- **download_to partial cleanup** — best-effort `unlink` of partial file on `body_too_large` or stream error.
- **jq timeout detection** — `JqTimeoutError` class instead of substring sentinel match.
- **jq output_mode='first' empty output** — returns `null` (not `undefined`).
- **`renderSchema` exhaustiveness** — switch gains `default` with `never`-typed exhaustiveness guard.
- **`schema/paths` root depth overflow** — uses `(root).???` instead of stray-leading-dot `.???`.
- **`http_read` binary cast guard** — surfaces a clear error instead of crashing when the original request used `download_to` (body=null).
- **`pathEnv` whitespace** — trims before `path.resolve`.
- **Version drift** — server version now injected at build time from `package.json` via tsup `define`, not a hardcoded literal.

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
