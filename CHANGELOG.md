# Changelog

## 0.3.0 — 2026-05-10

**Renamed: `rest-magpie` → `mcp-peek`.** New tagline: *"Peek the schema, slice the body."* The package was published with effectively zero real installs (one-day bot-traffic spike, otherwise zero), so this is taken as a hard rename rather than a re-publish-and-alias dance.

### Breaking
- **npm package:** `rest-magpie` → `mcp-peek`. Old package is deprecated with a pointer to the new one. Install via `npm i mcp-peek` / `npx -y mcp-peek`.
- **GitHub repo:** `ed-smartass/rest-magpie` → `ed-smartass/mcp-peek`. GitHub keeps a permanent redirect from the old slug, so existing clones / links continue to work.
- **GHCR image:** `ghcr.io/ed-smartass/rest-magpie` → `ghcr.io/ed-smartass/mcp-peek`. Old image tags remain by digest but receive no new pushes.
- **Env-var prefix:** every `MAGPIE_*` env var is renamed to `PEEK_*` (17 vars, e.g. `MAGPIE_FILES_ROOT` → `PEEK_FILES_ROOT`, `MAGPIE_INLINE_BODY_CAP` → `PEEK_INLINE_BODY_CAP`). No backwards-compat alias — mid-flight one-step rename while installs are zero.
- **Bin name:** `rest-magpie` → `mcp-peek`. The Claude Desktop / Cursor / VS Code / etc. config snippets in the README all spawn `npx -y mcp-peek` now.
- **MCP server identifier:** the server announces itself as `name: "mcp-peek"` in the JSON-RPC `initialize` handshake.

### Docs
- **README hero rewrite.** New tagline (`Peek the schema, slice the body.`), inline live-demo link instead of pill-button.
- **New "Built for the agent" section** consolidating the three structural hooks: schema-first, `next_step_hints` + structured error envelopes (= self-correcting agent loop), and re-read via `cache_id`. Reframes the existing token-savings + single-permission stories as *consequences* of the agent-first design rather than parallel pitches.
- **Agent-vs-human framing fix** starting at `## Tools`. Examples in `## Real-world examples` are now prefixed "The agent does:" so a human reader doesn't mistake the pseudo-code for CLI invocations.
- **Comparison table** gains a row for "Structured errors + `next_step_hints`".
- **Spec doc** renamed `2026-05-09-rest-magpie-design.md` → `2026-05-09-mcp-peek-design.md`, content updated.
- **`server_info` example** version bumped to `0.3.0`.

### Why now
Zero real installs means the rename window is wide open and migration friction is theoretical, not actual. Promo (HN / r/ClaudeAI / dev.to / aggregators) is gated on a stable name; doing the rename *before* promo is the only way to avoid leaving v0.2 footprints across the open web.

## 0.2.2 — 2026-05-10

External code review pass closing four correctness issues, two spec/doc drifts, and one Windows-portability bug Copilot flagged on the fix-PR itself. No public API changes; all fixes are behaviour-preserving on POSIX, behaviour-tightening on Windows + edge-case responses.

### Fixed
- **`MAGPIE_FILES_ROOT` bypass via symlinked parent (security).** When a target file didn't yet exist (typical for `download_to` / `save_to`), `canonicalize` fell back to lexical `path.resolve` — meaning `<root>/symlinked-dir/new.txt` could pass `isUnderRoot` while the actual write landed outside `MAGPIE_FILES_ROOT`. `canonicalize` now walks up to the nearest existing ancestor, `realpathSync`s that, and re-attaches the non-existent suffix. Implementation uses `path.dirname` + `path.parse(abs).root` so it works on POSIX, Windows drive roots (`C:\\`), and UNC shares.
- **307 / 308 redirect on streamed (multipart) body now fails fast.** RFC 7231 says preserve method+body, but a Readable body has been consumed by the first request — replaying it threw "Response body object should not be disturbed or locked" from undici, which surfaced as a generic `network_error`. Now detected explicitly: `invalid_input` with the final URL so the caller can re-issue the request directly.
- **`next_step_hints` no longer suggests `map({id, name})` for scalar arrays.** For `{ data: [1,2,3] }` the projection is nonsense and produces a jq parse error if the agent runs it. Branches on object-array vs scalar-array; scalars get `unique` instead, and projections use identifier-safe keys actually present on the first object.
- **`body_mode: "auto"` on empty body now resolves to `inline`** (matches spec §4). Previously returned `schema`. Body is `null` either way; the behaviour change is observable only in `meta.body_inclusion.resolved_mode`.
- **`http_inspect` now returns `next_step_hints` for JSON bodies** (matches spec §5.6). Previously the spec advertised it but the wire response only carried `schema`.
- **Binary + `body_mode: "inline"` error message no longer suggests `http_read`.** After v0.2.1's recovery-path narrowing there's no `cache_id` surfaced for that error, so the previous "use download_to or http_read with save_to" was misleading. Now: "use download_to to stream straight to disk, or omit body_mode (defaults to schema for binary)".

### Docs
- README `server_info` example: version `0.2.0` → `0.2.1`.
- `CONTRIBUTING.md` CHANGELOG template uses `X.Y.Z — YYYY-MM-DD` placeholder instead of a stale specific version/date.

## 0.2.1 — 2026-05-10

Post-v0.2 hardening pass closing ten correctness issues from two rounds of Copilot review on the v0.2 PR wave (#22, #25, #26, #29), plus a small wire-level rename for naming consistency (`meta.body_inclusion.inline_cap_bytes` → `inline_body_cap_bytes`) — taken now while there are 0 npm installs to migrate. README also reorganised for promo readiness (per-client install snippets, `body_mode` and `server_info` sections, concrete token-savings table on real APIs).

### Fixed
- **`body_too_large_for_inline` now actually surfaces a usable `cache_id`.** Previous code returned the error before `cache.put`, and `error.detail` omitted `cache_id` entirely, so the recovery hint ("use `http_read` with the returned cache_id") was a lie. Entry is now cached with a placeholder `body_inclusion` and `cache_id` is spliced into the error detail.
- **Cache-on-error narrowed to `body_too_large_for_inline` only.** First pass cached on every `!resolution.ok` branch and stamped a "cap exceeded" reason on every error's `body_inclusion`, which was wrong for `invalid_input` (e.g. `body_mode: 'inline'` on a binary response). Other resolution errors now surface as-is — no spurious cache entry, no `cache_id` in detail.
- **`decodeBase64` rejects malformed input loudly.** `Buffer.from(s, 'base64')` does not throw — it silently strips invalid characters. Strict alphabet/length validation (`^[A-Za-z0-9+/]*={0,2}$` + length divisible by 4 + `typeof` guard) added before decoding, so genuinely-bad `content_base64` returns `invalid_input` instead of a degraded buffer.
- **`decodeBase64` pre-decode size guard.** Encoded length is checked against `ceil(cap/3)*4 + slack` BEFORE `Buffer.from` allocates — a 1 GB syntactically-valid base64 string would otherwise OOM before the post-decode cap check.
- **Path guard on multipart files tightened.** Schema-bypass payloads like `{content_base64: "...", path: null}` previously reached `realpathSync(null)` and crashed; now the guard uses `typeof file.path !== 'string'` and falls through to the inline branch.
- **`inferNextStepHints` no longer emits invalid jq for non-identifier keys.** Keys with hyphens, leading digits, or spaces produced parse errors when interpolated into `.foo` or `{foo}` shorthand. Identifier-safe filter added; non-identifier keys are skipped from projection shorthand or rendered with bracket-quoted form `."weird-key"` for path access. Bracket-quoted form strips the entire ASCII control range (`\x00-\x1F` plus `\x7F`), not just CR/LF/TAB/NUL.
- **Multipart `oneOf` variants gain `additionalProperties: false`.** Closes the schema-level hole where `{path, content_base64}` and similar mixtures could match a variant unchanged.
- **`writeWithBackpressure` races `drain` against `error`/`close`.** Awaiting only `drain` meant a disk-full / EPERM during backpressure left the request hung forever. Three-way race with cleanup of unused listeners.
- **Redirect 301/302/303 method downgrade now drops ALL `content-*` headers**, not just `content-type` and `content-length`. Closes `content-encoding` / `content-language` / `content-md5` leaks across the redirect.

### Changed
- **`meta.body_inclusion.inline_cap_bytes` → `inline_body_cap_bytes`** (and same key in `error.detail` on `body_too_large_for_inline`). Now matches the env var (`MAGPIE_INLINE_BODY_CAP`) and the `server_info.effective_limits.inline_body_cap_bytes` field. Wire-level rename — safe right now (0 installs).
- **README reorganised.** Per-client install snippets (Claude Desktop, Claude Code, VS Code `.vscode/mcp.json`, Cursor, Cline, Windsurf, Docker) replace the v0.1 TL;DR. New `body_mode` modes table, `server_info` debug callout, `content_base64` upload example, full env-var refresh, and a "How much context does this actually save?" table with approximate savings on GitHub Issues / Stripe Charges / OpenWeather forecast.
- **npm-downloads badge** added to the badge row.

### Spec
- `MAX_RESPONSE_BYTES` → `MAGPIE_MAX_RESPONSE_BYTES` in §6 and §9.
- `body_inclusion` shape example: `inline_cap_bytes` → `inline_body_cap_bytes` to match the wire format.
- Literal `|` escaped inside the markdown table cell for the `next_step_hints` Object-with-array-fields sample.
- Run-modes matrix entry for `multipart.files[].content_base64` reads "works (zero-volume Docker)" instead of "n/a", consistent with the §8.2 copy that promotes Docker for the inline-payload path.
- Comment fix in `src/core/paths.ts` describing why root='/' needs the short-circuit.

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
