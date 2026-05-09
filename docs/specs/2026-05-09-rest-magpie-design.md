# rest-magpie — Design Spec

**Status:** approved for implementation
**Date:** 2026-05-09
**Owner:** smartass
**Repo:** TBD (to be created — proposed `github.com/<user>/rest-magpie`)
**npm:** `rest-magpie` (verified available)
**Docker:** `ghcr.io/<user>/rest-magpie`

> Tagline: *"REST that picks only the shiny bits."*

---

## 1. Problem & Goal

LLM agents using MCP tooling for REST APIs face two recurring pains:

1. **Context blowout.** A 200KB JSON response wastes half the agent's working context. `curl + jq` works but requires the agent to either fetch-then-trim (wasted bytes still cross the boundary) or guess the schema and filter on first request.
2. **Friction.** Agents end up writing brittle `curl` invocations, juggling shell quoting, and triggering permission prompts for every distinct command.

**Goal.** Provide a single MCP server that:

- Handles arbitrary HTTP requests (any method, headers, body formats including multipart).
- Caches the response in memory.
- Returns a **schema** of the response by default — not the body — so the agent sees structure cheaply and writes a precise extraction afterward.
- Lets the agent extract fields via **jq** from the cached body without a second HTTP call.
- Supports four schema formats and an `auto`/`true`/`false` mode for inlining small bodies.

## 2. Non-goals (explicit YAGNI)

- OAuth refresh, SSO, signed-request schemes, mTLS — passthrough headers only.
- Persistent storage. Cache is in-memory; restart = clean slate.
- Rate-limiting, retries, circuit breakers — agent's responsibility.
- Pagination — agent's responsibility (the schema surfaces `next_cursor`-like fields).
- Cookie jars — passthrough via `Cookie` header is enough.
- Streaming / SSE — buffered request-response model only.
- Saved profiles / credential storage. Headers go in each call.
- Pretty-printing HTML to markdown — that's `fetch-mcp`'s territory; rest-magpie returns raw text.

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ MCP stdio transport (@modelcontextprotocol/sdk)             │
└─────────────────────────────────────────────────────────────┘
                            │
       ┌────────────────────┼─────────────┬────────────────┐
       ▼                    ▼             ▼                ▼
  http_request          http_read    http_inspect     server_info
  (HTTP + cache +       (jq filter   (re-render       (runtime +
   schema render)       or full      schema in        effective
                        body or      different        limits, no
                        save_to)     format)          side effects)
       │                    │                    │
       └────────────┬───────┴───────────┬────────┘
                    ▼                   ▼
        ┌────────────────────┐  ┌────────────────────┐
        │  in-memory cache   │  │  schema renderers  │
        │  (Map + TTL=600s)  │  │  paths/shape/      │
        └────────────────────┘  │  sample/json_schema│
                    ▲           └────────────────────┘
                    │                   ▲
        ┌───────────────────────┐       │
        │   HTTP client core    │───────┘
        │ (undici / fetch +     │
        │  multipart + redir +  │
        │  decompress + tls)    │
        └───────────────────────┘
```

### Components

| Module | Responsibility |
|---|---|
| `tools/http_request.ts` | top-level entry: validates input, dispatches HTTP, caches, renders schema, optionally inlines body |
| `tools/http_read.ts` | reads cached body, applies jq mask if any, or saves to file for binaries |
| `tools/http_inspect.ts` | renders alternate schema format on already-cached body |
| `tools/server_info.ts` | one-shot debug tool: returns version, runtime detection, cwd, files_root, effective env-var values |
| `core/http.ts` | undici-based fetch + multipart builder + redirect/decompress/TLS handling |
| `core/cache.ts` | in-memory store keyed by random `cache_id`, TTL eviction via timer |
| `core/jq.ts` | jq-wasm wrapper (default) + opt-in subprocess to `node-jq` |
| `core/schema/*.ts` | four schema renderers — `paths`, `shape`, `sample`, `json_schema` |
| `core/content_type.ts` | classifies response body as JSON / text / binary |
| `core/errors.ts` | unified error envelope with stable `kind` codes |
| `config.ts` | env-var loader |
| `index.ts` | MCP server bootstrap (stdio transport) |

## 4. Tools

All tools return either a success object **or** `{ error: { kind, message, detail? } }`. Errors never throw at the MCP transport level for predictable input/HTTP failures; they throw only for unrecoverable bugs.

### 4.1 `http_request`

> Parameter order below is **the canonical order** — implementers MUST keep this order in the JSON Schema `properties` object. MCP transmits named arguments (order doesn't affect call semantics), but LLM clients read schema top-to-bottom, so a thoughtful order improves the agent's call-writing UX. Most-used first; related params grouped; rarely-used last.

```ts
http_request({
  // 1. Request line — always specified
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS",
  url: string,                              // absolute URL
  query?: Record<string, string | string[]>,// merged into URL

  // 2. HTTP layer — frequently customized
  headers?: Record<string, string>,

  // 3. Body group — mutually exclusive; content_type pairs with this group
  body?: unknown,                            // object → JSON.stringify, content-type=application/json
  body_raw?: string,                         // raw payload; pair with content_type
  multipart?: {
    fields?: Record<string, string>,
    files?: Record<string, MultipartFile>,
  },
  content_type?: string,                     // explicit override of inferred Content-Type

  // 4. Network policy — rarely changed; sensible defaults
  timeout_ms?: number,                       // default 30000
  follow_redirects?: boolean,                // default true (max 10 hops)
  tls_insecure?: boolean,                    // default false

  // 5. Output shape — what to return
  schema_format?: "paths" | "shape" | "sample" | "json_schema",  // default "paths"
  body_mode?: "auto" | "schema" | "head" | "inline",             // default "auto"

  // 6. Alternative output — uncommon: stream body to file instead of caching
  download_to?: string,
}) → {
  cache_id: string,                          // opaque token usable in http_read / http_inspect
  status: number,
  meta: {
    url: string,                             // final URL after redirects
    method: string,
    duration_ms: number,
    response_headers: Record<string, string>,
    body_bytes: number,
    content_type: string,                    // raw value of Content-Type header
    body_kind: "json" | "text" | "binary" | "empty",
    body_inclusion: {
      resolved_mode: "schema" | "head" | "inline",  // what mode actually applied (for "auto")
      inline_threshold_bytes: number,               // current MAGPIE_INLINE_THRESHOLD_BYTES
      head_preview_threshold_bytes: number,         // current MAGPIE_HEAD_PREVIEW_THRESHOLD
      head_preview_items: number,                   // current MAGPIE_HEAD_PREVIEW_ITEMS
      head_preview_string_chars: number,            // current MAGPIE_HEAD_PREVIEW_STRING
      inline_cap_bytes: number,                     // current MAGPIE_INLINE_BODY_CAP
      reason?: string,                              // populated only when the resolved mode wasn't obvious
    },
    redirect_chain: string[],                // empty if no redirects
    download_path?: string,                  // present iff download_to was used
  },
  schema: string | object,                   // string for paths/shape/sample; object for json_schema; or descriptor for non-json
  next_step_hints?: string[],                // advisory jq-mask suggestions inferred from top-level shape (JSON only)
  body_preview?: unknown,                    // present iff resolved_mode === "head"; arrays/strings truncated with sibling _truncated markers
  body?: unknown,                            // present iff resolved_mode === "inline"
}
```

`MultipartFile` is one of two shapes (exactly one of `path` or `content_base64` required):

```ts
type MultipartFile =
  | { path: string;          filename?: string; content_type?: string } // server-side absolute path (in-container if dockerized)
  | { content_base64: string; filename?: string; content_type?: string } // inline payload, decoded from base64
```

**Body validation.** Exactly one of `body | body_raw | multipart` must be supplied for methods that take a body. `download_to` is mutually exclusive with `body_mode: "inline"`. Sending the legacy field `include_body` returns `error.kind = "unsupported_field"` with a migration hint.

**`body_mode` resolution.**

```
body_mode == "schema"  → never include the body inline; only the schema is returned.
                         resolved_mode = "schema" for every body_kind (incl. empty / binary).

body_mode == "inline"  → include the full body iff body_kind ∈ {json, text} AND
                         body_bytes ≤ MAGPIE_INLINE_BODY_CAP.
                         body_kind == binary  → invalid_input (binaries are never inlined; use save_to or download_to).
                         body_kind == empty   → resolved_mode = "inline", body = null.
                         body_bytes > cap     → body_too_large_for_inline error;
                                                cache_id still valid (agent pivots to http_read).

body_mode == "head"    → include schema + body_preview.
                         body_kind == json    → arrays truncated to MAGPIE_HEAD_PREVIEW_ITEMS, strings to
                                                MAGPIE_HEAD_PREVIEW_STRING chars; sibling _truncated markers
                                                describe what was dropped.
                         body_kind == text    → body_preview = first MAGPIE_HEAD_PREVIEW_STRING chars +
                                                _truncated marker if longer; effectively the existing
                                                non-JSON descriptor's `head` field promoted to a
                                                first-class field.
                         body_kind == binary  → invalid_input (no preview for binaries).
                         body_kind == empty   → resolved_mode = "head", body_preview = null.

body_mode == "auto"    → server picks:
                           body_kind == binary  → "schema" (binaries are never inlined or previewed inline).
                           body_kind == empty   → "inline" (the body is null; trivially small, no harm).
                           body_bytes ≤ MAGPIE_INLINE_THRESHOLD_BYTES   → "inline"
                           ≤ MAGPIE_HEAD_PREVIEW_THRESHOLD              → "head"
                           else                                          → "schema"
```

The `meta.body_inclusion.resolved_mode` reports which mode actually applied; the response field that carries the body matches (`body` for inline, `body_preview` for head, neither for schema). For convenient debugging without a separate `server_info` call, `body_inclusion` also surfaces `head_preview_items` and `head_preview_string_chars` so an agent can see what truncation was applied.

**`next_step_hints`.** Advisory only. The server inspects the top-level shape of the parsed body and proposes a few canonical jq masks (e.g. for an array of objects: `length`, `[:5]`, `map({k1, k2})`, `sort_by(...)`). Hints are absent when the body is non-JSON and may be empty for shapes the inferer doesn't recognise. The agent picks one or writes its own; the server does not run them.

### 4.2 `http_read`

```ts
http_read({
  cache_id: string,
  mask?: string,                             // jq expression; only valid for body_kind=json
  output_mode?: "first" | "all",             // default "all"; how to collect multi-output jq results
  save_to?: string,                          // server-side path; required to retrieve binary content
}) → {
  result: unknown,                           // shape depends on body_kind:
                                             //   json   → jq result (or full parsed object if no mask)
                                             //   text   → string (full body); mask must be absent
                                             //   binary → { saved_to, byte_count, sha256 }; save_to required
                                             //   empty  → null
}
```

Errors: `cache_miss`, `mask_not_applicable`, `jq_syntax_error`, `jq_runtime_error`, `jq_timeout`, `save_failed`.

### 4.3 `http_inspect`

```ts
http_inspect({
  cache_id: string,
  schema_format: "paths" | "shape" | "sample" | "json_schema",
}) → {
  schema: string | object,
}
```

Re-renders schema for an already-cached response without an HTTP roundtrip. Errors: `cache_miss`, plus `mask_not_applicable`-equivalent if body_kind is non-json (returns the descriptor unchanged regardless of `schema_format`).

### 4.4 `server_info`

```ts
server_info({}) → {
  version: string,                                  // build-time version (matches package.json)
  runtime: "npx" | "docker" | "unknown",            // detected via /.dockerenv + heuristics
  cwd: string,                                      // process.cwd()
  files_root: string | null,                        // resolved MAGPIE_FILES_ROOT or null when unset
  effective_limits: {
    inline_threshold_bytes: number,
    head_preview_threshold_bytes: number,
    head_preview_items: number,
    head_preview_string_chars: number,
    inline_body_cap_bytes: number,
    max_response_bytes: number,
    cache_ttl_seconds: number,
    jq_timeout_ms: number,
    default_timeout_ms: number,
    max_inline_file_bytes: number,
    schema_max_depth: number,
    schema_max_object_keys: number,
    schema_sample_max_string: number,
    tls_insecure: boolean,
    use_native_jq: boolean,
  },
}
```

No params. One-shot, idempotent, no side effects, no cache. Intended as a debug surface — agents and humans use it when a path is rejected unexpectedly or to confirm which container/host the server is actually running in.

## 5. Schema formats

Applied only to JSON bodies. For text/binary/empty, `schema` is the descriptor in `meta.body_kind`-shape:

| body_kind | schema value |
|---|---|
| `text` | `{ type: "text", content_type, char_count, line_count, head: <first 300 chars> }` |
| `binary` | `{ type: "binary", content_type, byte_count, sha256 }` |
| `empty` | `{ type: "empty" }` |

### 5.1 `paths` (default) — flat path listing

Output is **plain text** (line-per-path) with footer summary. One pass, depth-limited.

```
data[].id            : int    (e.g. 42)
data[].name          : string (e.g. "alice")
data[].roles[]       : string (e.g. "admin")
data[].created_at    : string (e.g. "2026-05-09T12:00:00Z")
data[].profile.bio   : string|null
meta.total           : int    (e.g. 1247)
meta.next_cursor     : string|null

# 187 KB · data[]: 50 items
```

Algorithm:
1. Walk the parsed JSON depth-first.
2. For each leaf path, emit `path : type (e.g. value)`.
   - Type: `int`, `float`, `string`, `bool`, `null`, `object`, `array`. Heterogeneous arrays → union (e.g. `int | string`). Always-null at this path → `null`. Sometimes-null → `T|null`.
   - Sample value: 1 example, JSON-encoded; strings >60 chars → `"..."` + length suffix.
3. Arrays compress: `path[].leaf` (one row per inner leaf, type unioned across items).
4. Objects with > `MAX_OBJECT_KEYS` keys: list first N alphabetically + `# 234 more keys`.
5. Depth > `MAX_DEPTH`: emit `path.???: <max depth>`.
6. Footer: `# <human bytes> · arr[]: N items` for top-level array sizes.

### 5.2 `shape` — TypeScript-like

Indented (2 spaces), no examples, more compact than `paths` for deeply nested data:

```
{
  data: [{
    id: int,
    name: string,
    roles: string[],
    created_at: string,
    profile: { bio: string|null }
  }] (50 items),
  meta: { total: int, next_cursor: string|null }
}
# 187 KB
```

Same depth/key/union rules as `paths`; just rendered as a tree.

### 5.3 `sample` — first-of-each-array, full

Pretty JSON. First element of every array kept verbatim, rest replaced with `"...N more"` string sentinel. Long strings truncated to 100 chars + `"...(len=N)"`. Base64-looking strings (regex `^[A-Za-z0-9+/=]{200,}$`) truncated harder (50 chars).

```json
{
  "data": [
    { "id": 42, "name": "alice", "roles": ["admin"], "created_at": "2026-05-09T..." },
    "...49 more"
  ],
  "meta": { "total": 1247, "next_cursor": "abc123" }
}
```

### 5.4 `json_schema` — draft-2020-12

Inferred via `genson-js`. `required` is **omitted** (single-sample inference is unreliable). Output is JSON object, not string.

### 5.5 Common limits (env)

| Setting | Env | Default |
|---|---|---|
| Max depth | `MAGPIE_SCHEMA_MAX_DEPTH` | 10 |
| Max object keys | `MAGPIE_SCHEMA_MAX_OBJECT_KEYS` | 200 |
| Sample string max | `MAGPIE_SCHEMA_SAMPLE_MAX_STRING` | 100 |

### 5.6 `next_step_hints` (advisory)

Whenever a JSON body is rendered into a schema, the server also infers a small array of `next_step_hints` based on the top-level shape:

| Top-level shape | Sample hints |
|---|---|
| Array of objects | `length`, `[:5]`, `map({key1, key2})`, `sort_by(.created_at)[:10]` |
| Array of scalars | `length`, `[:10]`, `unique`, `min`, `max` |
| Object with array-valued field(s) | suggestions targeting each array field (e.g. <code>.data &#124; length</code>, `.data[:5]`) |
| Plain object | `keys`, projection helpers (`to_entries` / `map(...)`) |

Hints are strings of valid jq, but the server does **not** run them — the agent picks one or writes its own. Returned as `next_step_hints: string[]` on `http_request` and `http_inspect` responses. Empty array (or absent) for non-JSON bodies and unrecognised shapes.

## 6. Cache

- **Storage:** in-memory `Map<cache_id, CacheEntry>`. No SQLite, no persistence.
- **Key:** opaque random ULID-style `cache_id` (e.g. `req_01HXY7PZQ8...`). No deduplication; every `http_request` produces a new id even if URL/body are identical.
- **TTL:** 600 seconds (env `MAGPIE_CACHE_TTL_SECONDS`). On insert, schedule a `setTimeout` to evict; on access, no sliding (TTL is from creation).
- **Size:** bounded only by `MAGPIE_MAX_RESPONSE_BYTES` per entry (default 50MB). No global cap in MVP — restart and 10-min eviction keep it bounded.
- **Cache miss:** `error.kind = "cache_miss"` for `http_read` / `http_inspect` against unknown or expired ids.

`CacheEntry` shape:
```ts
{
  cache_id: string,
  created_at: number,
  body_kind: "json" | "text" | "binary" | "empty",
  body: unknown | string | Buffer | null,
  meta: { url, method, status, ... },
}
```

## 7. jq integration

- **Default engine:** `jq-wasm` (pure WASM, ~600KB, zero system deps). Bundled.
- **Opt-in native:** if `MAGPIE_USE_NATIVE_JQ=1`, use `node-jq` (subprocess to system `jq` binary). Faster on large bodies; requires `jq` installed.
- **Timeout:** 5000ms (env `MAGPIE_JQ_TIMEOUT_MS`). Implemented via `Promise.race` for wasm; via `subprocess.kill('SIGKILL')` for native.
- **Multi-output:** jq programs like `.data[]` produce multiple JSON outputs.
  - `output_mode: "all"` (default) — when jq emits multiple outputs, collect them into an array; when it emits a single output, return that value as-is.
  - `output_mode: "first"` — return the first emitted value (or `undefined` if jq emits nothing).
- **Errors:**
  - Parse failure → `jq_syntax_error` with the parser message.
  - Runtime failure (e.g. `Cannot index array with string`) → `jq_runtime_error`.
  - Exceeds timeout → `jq_timeout`.

## 8. HTTP layer

### 8.1 Body input handling

| Input | Wire | Default Content-Type |
|---|---|---|
| `body: <object>` | `JSON.stringify` | `application/json` |
| `body: <string>` | as-is | `text/plain; charset=utf-8` |
| `body_raw` | as-is | (must be supplied via `content_type`; else `invalid_input`) |
| `multipart` | RFC 2388 with random boundary | `multipart/form-data; boundary=...` |

`content_type` always overrides the default.

### 8.2 Multipart builder

Streaming builder backed by `Readable.from(asyncGenerator())`, fed into `fetch` with `duplex: "half"`.

- `multipart.files[].path` — streamed via `createReadStream`. Filename defaults to `basename(path)`; content_type defaults to `application/octet-stream`.
- `multipart.files[].content_base64` — decoded into a `Buffer` and streamed from memory. Useful for remote MCP scenarios where path semantics differ between agent and server, and for zero-volume Docker. Capped by `MAGPIE_MAX_INLINE_FILE_BYTES` (default 10 MB pre-base64). `MAGPIE_FILES_ROOT` does not apply to this mode (no path to canonicalise).
- Header positions (field name, filename, content_type) are validated for CR/LF/NUL and rejected with `invalid_input` if any control character is present (header injection guard); `\` and `"` in name/filename values are RFC 7578 §4.2 escaped.
- Uploads use **chunked transfer encoding** (no Content-Length). Most modern servers handle this; some primitive test servers / legacy reverse proxies reject it. Tracked for v0.3 compat-mode if real demand surfaces.
- No nested multipart support.

### 8.3 Response handling

1. Read full body up to `MAGPIE_MAX_RESPONSE_BYTES` (default 50MB) → `body_too_large` if exceeded (server tracks via `ReadableStream` byte counter; aborts cleanly).
2. If `download_to` was set, stream straight to file; cache only metadata (`{path, byte_count, sha256}`) with `body_kind="binary"`.
3. Otherwise classify by Content-Type (`core/content_type.ts`):
   - `application/json` or `*+json` → parse, body_kind=json
   - `text/*`, `application/xml`, `application/yaml`, `application/javascript` → text, body_kind=text
   - everything else → binary, store as `Buffer`
   - empty body (Content-Length 0 or 204 status) → body_kind=empty
4. For text: detect charset from Content-Type; decode. Failure → fall back to `binary`.

### 8.4 Network policy

| Setting | Default |
|---|---|
| Auto-decompress (gzip, brotli, deflate) | yes (undici default) |
| Follow redirects | yes, up to 10 hops; recorded in `meta.redirect_chain` |
| `follow_redirects: false` | returns 3xx response directly |
| TLS verify | strict; opt-out per-call (`tls_insecure: true`) or globally (`MAGPIE_TLS_INSECURE=1`) |
| HTTP/2/HTTP/3 | transparent via undici |
| Streaming / SSE | not supported (documented as out-of-scope) |
| Proxy | not in MVP |

## 9. Error model

Every error response:
```ts
{ error: { kind: string, message: string, detail?: object } }
```

Stable `kind` codes:

| kind | When |
|---|---|
| `invalid_input` | schema-level validation failures |
| `invalid_url` | URL parse failure |
| `timeout` | request exceeded `timeout_ms` |
| `network_error` | DNS, TCP refused, abort |
| `tls_error` | cert validation failure (when not insecure) |
| `redirect_loop` | exceeded max hops |
| `body_too_large` | response exceeded `MAGPIE_MAX_RESPONSE_BYTES` |
| `body_too_large_for_inline` | response cached but exceeded MAGPIE_INLINE_BODY_CAP for `body_mode: "inline"`; `error.detail.cache_id` is set so the agent can switch to `http_read` without refetching |
| `unsupported_field` | request used a removed/renamed parameter (e.g. legacy `include_body`); `error.message` includes a migration hint |
| `cache_miss` | cache_id unknown or expired |
| `jq_syntax_error` | jq could not parse expression |
| `jq_runtime_error` | jq runtime fault |
| `jq_timeout` | jq exceeded JQ_TIMEOUT_MS |
| `mask_not_applicable` | mask passed for non-JSON body |
| `save_failed` | filesystem write failed for save_to/download_to |

HTTP 4xx/5xx are **not** errors — `status` is returned as-is and the body is parsed/cached normally. Agents commonly need to inspect API error payloads.

## 10. Configuration

All env vars are optional with sensible defaults.

| Env | Default | Purpose |
|---|---|---|
| `MAGPIE_DEFAULT_TIMEOUT_MS` | 30000 | per-request HTTP timeout when not overridden |
| `MAGPIE_MAX_RESPONSE_BYTES` | 52428800 (50MB) | hard cap on in-memory response size |
| `MAGPIE_CACHE_TTL_SECONDS` | 600 | cache entry lifetime |
| `MAGPIE_INLINE_THRESHOLD_BYTES` | 8192 | `body_mode: "auto"` resolves to `"inline"` for bodies up to this size (renamed from `MAGPIE_AUTO_INCLUDE_BODY_BYTES`). |
| `MAGPIE_HEAD_PREVIEW_THRESHOLD` | 65536 (64 KB) | `body_mode: "auto"` resolves to `"head"` for bodies up to this size (when above the inline threshold). |
| `MAGPIE_HEAD_PREVIEW_ITEMS` | 5 | array preview length in `body_mode: "head"` |
| `MAGPIE_HEAD_PREVIEW_STRING` | 200 | string preview length (chars) in `body_mode: "head"` |
| `MAGPIE_INLINE_BODY_CAP` | 262144 (256 KB) | hard cap on `body_mode: "inline"`; over this → `body_too_large_for_inline` error |
| `MAGPIE_MAX_INLINE_FILE_BYTES` | 10485760 (10 MB) | cap on the decoded size of `multipart.files[].content_base64`; over this → `invalid_input` |
| `MAGPIE_JQ_TIMEOUT_MS` | 5000 | per-mask jq timeout |
| `MAGPIE_USE_NATIVE_JQ` | 0 | switch to subprocess `node-jq` |
| `MAGPIE_TLS_INSECURE` | 0 | global insecure TLS toggle |
| `MAGPIE_SCHEMA_MAX_DEPTH` | 10 | recursion depth for schema renderers |
| `MAGPIE_SCHEMA_MAX_OBJECT_KEYS` | 200 | per-object key cap |
| `MAGPIE_SCHEMA_SAMPLE_MAX_STRING` | 100 | string truncation in samples |
| `MAGPIE_FILES_ROOT` | (unset) | when set, every server-side file path (`multipart.files[].path`, `download_to`, `save_to`) must canonicalize to a location under this prefix; otherwise the call fails with `error.kind = "invalid_input"`. `multipart.files[].content_base64` is exempt (no path). Unset = no constraint. |

When `MAGPIE_FILES_ROOT` is set, the server also appends a one-line note to `http_request` and `http_read` tool descriptions (e.g. *"Server-side file paths must reside under `/data`."*) so LLM clients see the constraint at call-authoring time.

## 11. Repository layout

```
rest-magpie/
├── src/
│   ├── index.ts                  # MCP server bootstrap (stdio)
│   ├── tools/
│   │   ├── http_request.ts
│   │   ├── http_read.ts
│   │   └── http_inspect.ts
│   ├── core/
│   │   ├── http.ts               # undici client + multipart + redirect + decompress + tls
│   │   ├── cache.ts              # in-memory store + TTL eviction
│   │   ├── jq.ts                 # jq-wasm wrapper + native fallback
│   │   ├── schema/
│   │   │   ├── index.ts          # dispatcher
│   │   │   ├── paths.ts
│   │   │   ├── shape.ts
│   │   │   ├── sample.ts
│   │   │   └── json_schema.ts
│   │   ├── content_type.ts       # JSON / text / binary classifier
│   │   └── errors.ts             # unified error envelope
│   ├── config.ts                 # env loader
│   └── types.ts                  # public type defs
├── test/
│   ├── unit/                     # schema renderers, jq, cache, content_type, multipart
│   ├── integration/              # tools end-to-end against msw
│   └── fixtures/                 # sample JSON, HTML, binary, edge cases
├── docker/
│   └── Dockerfile                # node:20-alpine, multistage
├── .github/workflows/
│   ├── ci.yml                    # lint + typecheck + test on PR (matrix: node 20, 22)
│   └── release.yml               # on tag v*: npm publish + docker push (ghcr + docker.io)
├── README.md
├── LICENSE                       # MIT
├── package.json
├── tsconfig.json
├── biome.json                    # lint/format
└── .editorconfig
```

## 12. Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node 20 LTS (also test on 22) | broad compat, native fetch via undici |
| Language | TypeScript strict | ecosystem standard |
| MCP SDK | `@modelcontextprotocol/sdk` | official |
| HTTP | native fetch / `undici` | zero extra deps for HTTP |
| jq | `jq-wasm` (default) + `node-jq` (opt-in) | zero-deps default, escape hatch for power users |
| JSON Schema | `genson-js` | only for `schema_format: json_schema` |
| Tests | `vitest` + `msw` | fast, hot mocking |
| Lint/format | `biome` | one tool, no eslint+prettier dance |
| Build | `tsup` | single ESM bundle to `dist/index.js` |
| Release | `changesets` or conventional-commits | automated changelog/version |

## 13. Deployment & run modes

Three supported run modes: **npx** (default), **Docker**, and **remote MCP** (over HTTP / SSE; agent connects to a server hosted elsewhere). All three communicate with Claude or another MCP client via the standard MCP transport. The same `dist/index.js` underneath.

### File-path semantics by runtime

This is the largest source of real-world confusion, so it's the spec's job to be explicit:

| Field | npx | Docker | Remote MCP |
|---|---|---|---|
| `multipart.files[].path` | host (agent's) | container (use same-path bind mount) | server's filesystem (rarely useful — prefer `content_base64`) |
| `multipart.files[].content_base64` | works (but `path` is simpler) | works (zero-volume Docker — no bind mount needed) | **recommended** for remote — agent supplies the bytes inline |
| `download_to` | host (agent's) | container (use same-path bind mount) | server's filesystem |
| `save_to` (in `http_read`) | host (agent's) | container (use same-path bind mount) | server's filesystem |

`MAGPIE_FILES_ROOT`, when set, additionally constrains the three path-based fields to a canonicalised root. `content_base64` is exempt because there's no path to canonicalise.

### npm

```jsonc
// claude_desktop_config.json
{
  "mcpServers": {
    "rest-magpie": {
      "command": "npx",
      "args": ["-y", "rest-magpie"]
    }
  }
}
```

### Docker

```jsonc
{
  "mcpServers": {
    "rest-magpie": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        // Same-path bind mount: the host directory and the in-container
        // path are identical, so the agent's absolute paths "just work"
        // without any host↔container translation logic.
        "-v", "/home/me/data:/home/me/data",
        "-e", "MAGPIE_FILES_ROOT=/home/me/data",
        "ghcr.io/<user>/rest-magpie:latest"
      ]
    }
  }
}
```

**Path mapping convention.** Volume mounts are required for `multipart.files[].path`, `download_to`, and `save_to` to reference real host files. The recommended pattern is a *same-path bind mount* (`-v /host/X:/host/X`) paired with `-e MAGPIE_FILES_ROOT=/host/X`. With both set:

- The agent passes ordinary host paths under `/host/X/...`; they resolve identically inside the container — no path translation needed.
- `MAGPIE_FILES_ROOT` makes the constraint visible (it's appended to relevant tool descriptions) and enforces it (any path outside the root → `invalid_input` with a clear message).
- Path canonicalization rejects traversal escapes (`/host/X/../../etc/passwd` resolves to `/etc/passwd`, fails the check).

When `MAGPIE_FILES_ROOT` is unset, no constraint is applied — useful for `npx`-mode usage where the server's filesystem is the host's. In Docker without the env, the agent must guess host↔container path mapping itself, which it usually gets wrong; setting the env is the documented happy-path.

Image: multistage `node:20-alpine` → final `node:20-alpine` with only `dist/` and `package.json`. Should land under 100MB.

## 14. README outline

Order matters — first 30 lines decide whether someone stars the repo.

1. **Hook (1 sentence + animated demo gif).** "REST MCP that doesn't blow your context — see structure first, fetch only what you need."
2. **Why** (3 bullets): schema-first, jq, cache.
3. **Quick install** (npx + docker, copy-pasteable).
4. **Tools at a glance** (3-row table).
5. **Schema formats showcase** — same payload rendered in all four formats side-by-side.
6. **jq cheatsheet** — 8-10 patterns most agents need.
7. **Configuration** — env-var table.
8. **Comparison vs `fetch-mcp`, `curl`, others** — table.
9. **Real-world examples** — 3 cases (e.g. exploring an unknown REST endpoint, pulling specific fields from GitHub, uploading an image via multipart).
10. **License (MIT) + Contributing.**

## 15. Release scope

### v0.1.0 — initial release (DONE)

- All three tools with the v0.1 surface (`include_body: auto/true/false`).
- All HTTP methods. `body` / `body_raw` / `multipart` (path-based) body inputs.
- All four schema formats. jq-wasm engine. In-memory cache + 10-min TTL. `download_to`. JSON / text / binary / empty classification. Unified error envelope. Docker image. CI + release pipeline.

### v0.1.1 / v0.1.2 — patches (DONE)

- v0.1.1: fix bin entrypoint guard for symlinked launches (npx, `npm install -g`).
- v0.1.2: agent-UX patch — tool descriptions rewritten with default-flow lead, README run-modes section, richer `ensureUnderRoot` error envelope (runtime-aware hint).

### v0.2.0 — agent-UX bundle (in progress)

Replaces `include_body` with `body_mode` (breaking, no alias). Adds `body_mode: "head"` preview, `next_step_hints` schema add-on, `body_mode: "inline"` cap, `meta.body_inclusion` metadata, the `server_info` debug tool, and `multipart.files[].content_base64` for remote-MCP scenarios. Header-injection guard, symlink-resolution path validation, redirect method downgrade, build-time version inlining, and miscellaneous correctness fixes from the pre-v0.2 hardening pass.

### Backlog (v0.3+)

- Native `node-jq` engine path (env-toggle present since v0.1, no real exercise yet).
- Proxy support (`HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`).
- mTLS / client certs.
- Cookie jar (only if real demand emerges).
- `http_history` tool — list recent cache_ids and their request lines.
- Optional persistent cache (sqlite or fs) via env-flag.
- Multi-arch Docker (linux/arm64).
- Non-chunked multipart compat mode (only if a real legacy server is reported).
- `download_mode: "inline_base64"` on `http_request` — closes remote-MCP download asymmetry without an artifact handle layer; ship if/when remote-MCP traction surfaces a real need.
- Curl export / repro helper.
- Streaming/SSE — only if a clear MCP-shaped use case emerges.

### Rejected outright (will not be built)

- Artifact-oriented file flow (handle-based file API). Adds stateful artifact lifecycle (creation, TTL, cleanup, retention env, per-agent visibility). Real asymmetry it targets is closed cheaper by `content_base64` upload (in v0.2) plus a future `download_mode: "inline_base64"`.

## 16. CI / Release

- **PR pipeline:** Biome lint, `tsc --noEmit`, `vitest run`, build. Matrix: Node 20 + 22.
- **Tag pipeline (`v*.*.*`):** publish to npm (`rest-magpie`), build and push docker image to `ghcr.io/<user>/rest-magpie` and optionally `docker.io/<user>/rest-magpie`. Both `:latest` and `:v0.1.0` tags.
- **Branching:** trunk-based; PR → `main`; tag from `main`.
- **Versioning:** semver. `changesets` (preferred) or conventional commits.
- **License:** MIT.
- **Security:** Dependabot for security only (not minor bumps — too noisy for a small project).

## 17. Open questions / decisions that surfaced during design

These are settled but worth flagging for implementers:

- **No deduplication of cache.** Every request gets a new `cache_id` even if URL/body match. If you need re-fetch behavior, just call again.
- **HTTP 4xx/5xx are not MCP errors.** They flow through the success path with the response body fully cached.
- **`body_mode` resolution looks only at byte count, not structure.** A 7 KB JSON of base64 garbage will resolve to `"inline"`; a 9 KB nicely-shaped response will resolve to `"head"`. Both thresholds (`MAGPIE_INLINE_THRESHOLD_BYTES`, `MAGPIE_HEAD_PREVIEW_THRESHOLD`) tunable via env.
- **Multipart files have two payload shapes.** `path` is the default (server-side absolute path, streamed via `createReadStream`). `content_base64` is the remote-MCP/zero-volume alternative — same agent-UX, but bytes inline. They are mutually exclusive per file. Capped to keep base64-in-JSON-RPC bloat finite.
- **`schema_format: json_schema` returns an object, others return strings.** Agents need to check `typeof schema`. Documented in tool description.
- **`next_step_hints` are advisory, not authoritative.** The server proposes; the agent picks one or writes its own and calls `http_read` itself.
