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
       ┌────────────────────┼────────────────────┐
       ▼                    ▼                    ▼
  http_request          http_read           http_inspect
  (HTTP + cache +       (jq filter or       (re-render schema
   schema render)       full body or         in different
                        save_to file)        format on cache)
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
    files?: Record<string, {
      path: string,                          // server-side absolute path (in-container if dockerized)
      filename?: string,
      content_type?: string,
    }>,
  },
  content_type?: string,                     // explicit override of inferred Content-Type

  // 4. Network policy — rarely changed; sensible defaults
  timeout_ms?: number,                       // default 30000
  follow_redirects?: boolean,                // default true (max 10 hops)
  tls_insecure?: boolean,                    // default false

  // 5. Output shape — what to return
  schema_format?: "paths" | "shape" | "sample" | "json_schema",  // default "paths"
  include_body?: boolean | "auto",           // default "auto"

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
    body_included: boolean,
    redirect_chain: string[],                // empty if no redirects
    download_path?: string,                  // present iff download_to was used
  },
  schema: string | object,                   // string for paths/shape/sample; object for json_schema; or descriptor for non-json
  body?: unknown,                            // present iff meta.body_included
}
```

**Body validation.** Exactly one of `body | body_raw | multipart` must be supplied for methods that take a body. `download_to` is mutually exclusive with `include_body: true`. Violations → `error.kind = "invalid_input"`.

**Auto-include rule.**
```
include_body == true   → always include (unless binary / over limit)
include_body == false  → never include
include_body == "auto" → include iff body_kind in {json, text} AND body_bytes <= MAGPIE_AUTO_INCLUDE_BODY_BYTES (default 8192)
                         binary → always exclude even at 0 bytes (no inline binaries)
```

The `meta.body_included` boolean is authoritative; the `body` field's presence matches it.

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

## 6. Cache

- **Storage:** in-memory `Map<cache_id, CacheEntry>`. No SQLite, no persistence.
- **Key:** opaque random ULID-style `cache_id` (e.g. `req_01HXY7PZQ8...`). No deduplication; every `http_request` produces a new id even if URL/body are identical.
- **TTL:** 600 seconds (env `MAGPIE_CACHE_TTL_SECONDS`). On insert, schedule a `setTimeout` to evict; on access, no sliding (TTL is from creation).
- **Size:** bounded only by `MAX_RESPONSE_BYTES` per entry (default 50MB). No global cap in MVP — restart and 10-min eviction keep it bounded.
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

Simple in-memory builder. Files referenced by `path` are streamed (`createReadStream`). Filename defaults to `basename(path)`; content_type defaults to `application/octet-stream` if not specified. No nested multipart support.

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
| `body_too_large` | response exceeded MAX_RESPONSE_BYTES |
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
| `MAGPIE_AUTO_INCLUDE_BODY_BYTES` | 8192 | threshold for `include_body: "auto"` |
| `MAGPIE_JQ_TIMEOUT_MS` | 5000 | per-mask jq timeout |
| `MAGPIE_USE_NATIVE_JQ` | 0 | switch to subprocess `node-jq` |
| `MAGPIE_TLS_INSECURE` | 0 | global insecure TLS toggle |
| `MAGPIE_SCHEMA_MAX_DEPTH` | 10 | recursion depth for schema renderers |
| `MAGPIE_SCHEMA_MAX_OBJECT_KEYS` | 200 | per-object key cap |
| `MAGPIE_SCHEMA_SAMPLE_MAX_STRING` | 100 | string truncation in samples |
| `MAGPIE_FILES_ROOT` | (unset) | when set, every server-side file path (`multipart.files[].path`, `download_to`, `save_to`) must canonicalize to a location under this prefix; otherwise the call fails with `error.kind = "invalid_input"`. Unset = no constraint (current behavior for npm-mode users). |

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

## 13. Deployment

Both modes communicate with Claude over **stdio**. Same `dist/index.js` underneath.

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

## 15. MVP scope (v0.1.0)

**In:**
- All three tools with full spec'd surface.
- All HTTP methods.
- `body` / `body_raw` / `multipart` body inputs.
- Headers and query passthrough.
- `include_body: auto/true/false`.
- All four schema formats (default `paths`).
- `jq-wasm` engine.
- In-memory cache + 10min TTL.
- `download_to` for streaming large/binary responses.
- Hard limits via env.
- JSON / text / binary / empty body classification.
- Unified error envelope with all spec'd `kind`s.
- Docker image (alpine, multi-stage).
- README + npm + Docker + CI (lint/typecheck/test on PR; release on tag).
- Test coverage for: schema renderers (golden snapshots), jq integration, cache TTL, content-type classifier, multipart builder, end-to-end via msw.

**Backlog (v0.2+):**
- Native `node-jq` engine path (env-toggle present, but not heavily exercised in v0.1).
- Proxy support (`HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`).
- mTLS / client certs.
- Cookie jar (only if real demand emerges).
- `http_history` tool — list recent cache_ids and their request lines.
- Optional persistent cache (sqlite or fs) via env-flag.
- VS Code extension showing live cache contents.
- Exported TS types for downstream consumers.
- Streaming/SSE — only if a clear MCP-shaped use case emerges.

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
- **`include_body: auto` looks only at byte count, not structure.** A 7KB JSON of base64 garbage will be inlined; a 9KB nicely-shaped response will not. Threshold can be tuned via env.
- **Multipart files are server-side paths, not inline base64.** This is deliberate — base64-in-JSON-RPC bloats agent context. Volume-mount in Docker.
- **`schema_format: json_schema` returns an object, others return strings.** Agents need to check `typeof schema`. Documented in tool description.
