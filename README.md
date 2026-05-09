<p align="center">
  <img src="docs/images/banner.png" alt="rest-magpie — REST that picks only the shiny bits" width="100%">
</p>

<h1 align="center">rest-magpie</h1>

<p align="center">
  <em>REST that picks only the shiny bits.</em>
</p>

<p align="center">
  <a href="https://github.com/ed-smartass/rest-magpie/actions/workflows/ci.yml"><img src="https://github.com/ed-smartass/rest-magpie/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/rest-magpie"><img src="https://img.shields.io/npm/v/rest-magpie?color=cb3837" alt="npm"></a>
  <a href="https://www.npmjs.com/package/rest-magpie"><img src="https://img.shields.io/npm/dw/rest-magpie?color=cb3837&label=downloads" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ed-smartass/rest-magpie" alt="MIT"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-compatible-6f42c1" alt="MCP"></a>
</p>

---

> Your agent just burned **12K tokens** on a 200KB JSON response — to read one field. **With rest-magpie: ~250 tokens** for the same field. Same call, ~50× less context.

`rest-magpie` is an MCP server that wraps arbitrary REST API calls so your agent **first sees a compact schema**, then pulls **only what it asked for** through a jq mask. Big responses stay out of context until you actually need a slice.

<p align="center">
  <a href="https://ed-smartass.github.io/rest-magpie/"><strong>→ Live demo</strong></a>
</p>

## Use it in

Drop the snippet for your client into its MCP config. All clients run the same `npx -y rest-magpie` underneath; the wrapping JSON differs slightly.

<details>
<summary><strong>Claude Desktop</strong> — <code>claude_desktop_config.json</code></summary>

```jsonc
{
  "mcpServers": {
    "rest-magpie": {
      "command": "npx",
      "args": ["-y", "rest-magpie"]
    }
  }
}
```

Config file lives at `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows). Restart Claude Desktop after editing.
</details>

<details>
<summary><strong>Claude Code</strong> — one CLI command</summary>

```sh
claude mcp add rest-magpie -- npx -y rest-magpie
```

Or edit `~/.claude.json` (user scope) / `.mcp.json` (project scope) directly with the same `mcpServers` shape as Claude Desktop.
</details>

<details>
<summary><strong>VS Code</strong> — <code>.vscode/mcp.json</code></summary>

```jsonc
{
  "servers": {
    "rest-magpie": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "rest-magpie"]
    }
  }
}
```

VS Code uses `servers` (not `mcpServers`) and requires `type`. Workspace-scoped — commit it for your team.
</details>

<details>
<summary><strong>Cursor</strong> — <code>~/.cursor/mcp.json</code> or <code>.cursor/mcp.json</code></summary>

```jsonc
{
  "mcpServers": {
    "rest-magpie": {
      "command": "npx",
      "args": ["-y", "rest-magpie"]
    }
  }
}
```
</details>

<details>
<summary><strong>Cline</strong> — VS Code extension settings</summary>

```jsonc
{
  "mcpServers": {
    "rest-magpie": {
      "command": "npx",
      "args": ["-y", "rest-magpie"]
    }
  }
}
```

Cline stores this in `cline_mcp_settings.json` (open from the Cline panel → MCP Servers → Configure).
</details>

<details>
<summary><strong>Windsurf</strong> — <code>~/.codeium/windsurf/mcp_config.json</code></summary>

```jsonc
{
  "mcpServers": {
    "rest-magpie": {
      "command": "npx",
      "args": ["-y", "rest-magpie"]
    }
  }
}
```
</details>

<details>
<summary><strong>Docker</strong> (any client) — same-path bind mount</summary>

```jsonc
{
  "mcpServers": {
    "rest-magpie": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        // Same-path bind mount + MAGPIE_FILES_ROOT: the agent passes
        // ordinary host paths under /home/me/data and they "just work"
        // inside the container. Outside-the-root paths are rejected
        // with a clear `invalid_input` error.
        "-v", "/home/me/data:/home/me/data",
        "-e", "MAGPIE_FILES_ROOT=/home/me/data",
        "ghcr.io/ed-smartass/rest-magpie:latest"
      ]
    }
  }
}
```

The same-path bind mount is the recommended Docker pattern — agent paths translate transparently. Drop `MAGPIE_FILES_ROOT` if you want no path constraint (and you're sure about the security tradeoffs).
</details>

## What you get

- **`http_request`** runs the call, caches the body, returns the **structure**, not the bytes.
- **`http_read`** pulls fields out of the cached body via `jq`.
- **`http_inspect`** re-renders the schema in another format — no second HTTP call.
- **`server_info`** debug helper — version, runtime, effective env limits.

One MCP install replaces every `curl` your agent would run, so you authorize once at config time instead of approving each call.

## Run modes & file paths

### Which mode to pick

| Mode | Pick when | Trade-offs |
|---|---|---|
| **npx (default)** | The MCP server runs on the same machine as your agent. | Simplest setup. Paths are local to your host — what the agent passes is what the server sees. |
| **Docker** | You want isolation, or are running the server alongside other tooling in containers. | Paths are local to the container. Use the same-path bind mount + `MAGPIE_FILES_ROOT` pattern (above) so agent paths "just work" without translation. |
| **Remote MCP** (over HTTP / SSE) | The server runs on shared infrastructure separate from the agent. | **Surprising default:** any path you pass for `multipart.files[].path`, `download_to`, or `save_to` resolves on the *server*, not the agent's filesystem. For uploads, pass `multipart.files[].content_base64` instead (since v0.2) — the bytes travel inline in the JSON-RPC frame, no path semantics involved. Downloads still don't have an inline-base64 mode; keep `download_to` to npx/Docker. |

### Where do file paths resolve?

| Field | npx | Docker | Remote MCP |
|---|---|---|---|
| `multipart.files[].path` | host (agent's) | container — use same-path mount | server's filesystem |
| `download_to` | host (agent's) | container — use same-path mount | server's filesystem |
| `save_to` (in `http_read`) | host (agent's) | container — use same-path mount | server's filesystem |

When `MAGPIE_FILES_ROOT` is set, all three are also constrained to that root (canonicalised — `..` traversal cannot escape).

### Multipart compatibility

Multipart uploads stream files via **chunked transfer encoding** (no `Content-Length` header). Most modern HTTP servers handle this fine. If you hit a server that rejects chunked uploads — typically primitive test servers or some legacy reverse proxies — file an issue with the response body, and we'll consider a non-chunked fallback in v0.3.

## Tools

> **Default flow:** call `http_request` to get a schema + `cache_id`, then call `http_read` with a jq mask to extract only what you need. Keeps your context small even on multi-MB responses. Setting `body_mode: "inline"` is rarely the right call — see [body modes](#body-modes) for cost framing.

| Tool | What it does |
|---|---|
| `http_request` | Run an HTTP request; cache the body; return a schema (and optionally a preview / full body, governed by `body_mode`). |
| `http_read` | Read a cached body, optionally filtered by a `jq` mask. Required for binaries (use `save_to`). |
| `http_inspect` | Re-render the cached body's schema in another format — no second HTTP call. |
| `server_info` | Debug helper. No params. Returns version, runtime, `MAGPIE_FILES_ROOT`, and every effective limit. |

### Body modes

`http_request` returns a schema by default. The `body_mode` parameter controls how much (if any) of the actual body comes back inline:

| Mode | Returns | When to use |
|---|---|---|
| `schema` | schema only | You will follow up with `http_read` + a jq mask. |
| `head` | schema + `body_preview` (arrays/strings truncated, `_truncated` markers) | You want a quick peek to decide what to extract next. |
| `inline` | schema + the full body | You know the response is small and you need every field. Capped by `MAGPIE_INLINE_BODY_CAP` (256 KB default). |
| `auto` *(default)* | server picks based on byte thresholds | Inline under `MAGPIE_INLINE_THRESHOLD_BYTES` (8 KB), head up to `MAGPIE_HEAD_PREVIEW_THRESHOLD` (64 KB), schema beyond that. |

The actual mode picked, and the thresholds in effect, come back on every response in `meta.body_inclusion` so the agent can introspect what `auto` resolved to. JSON responses also get `next_step_hints` — advisory jq mask suggestions inferred from the top-level shape.

### Debugging unexpected behaviour: `server_info`

When a path is rejected with `invalid_input`, or a tool behaves differently than you'd expect (Docker vs. host mode, a stale env var, the wrong version), call `server_info` first. It returns:

```jsonc
{
  "version": "0.2.0",
  "runtime": "docker" /* or "npx" / "unknown" */,
  "cwd": "/app",
  "files_root": "/home/me/data",          // null if MAGPIE_FILES_ROOT is unset
  "effective_limits": {
    "default_timeout_ms": 30000,
    "max_response_bytes": 52428800,
    "inline_threshold_bytes": 8192,
    "head_preview_threshold_bytes": 65536,
    "inline_body_cap_bytes": 262144,
    "max_inline_file_bytes": 10485760,
    /* …10 more fields… */
  }
}
```

No params. Cheap to call. Beats guessing why a path rejection said "/home/me/data" when you swore you set `MAGPIE_FILES_ROOT=/data`.

## Schema formats

The same `/users` endpoint, four ways:

**`paths` (default)** — flat path listing, type + one example per leaf:
```
data[].id            : int    (e.g. 42)
data[].name          : string (e.g. "alice")
data[].roles[]       : string (e.g. "admin")
data[].profile.bio   : string|null
meta.total           : int    (e.g. 1247)
meta.next_cursor     : string|null

# 187 KB · data[]: 50 items
```

**`shape`** — TypeScript-like tree, more compact for deep data:
```
{
  data: [{
    id: int, name: string, roles: string[], profile: { bio: string|null }
  }] (50 items),
  meta: { total: int, next_cursor: string|null }
}
# 187 KB
```

**`sample`** — first item kept verbatim, rest collapsed; long strings auto-truncated:
```jsonc
{
  "data": [
    { "id": 42, "name": "alice", "roles": ["admin"], "created_at": "2026-05-09T..." },
    "...49 more"
  ],
  "meta": { "total": 1247, "next_cursor": "abc123" }
}
```

**`json_schema`** — standard JSON Schema (draft 2020-12), inferred via `genson-js`. Useful when feeding the schema back into a typed pipeline.

Pick the format that matches what the agent is doing: `paths` for "what fields exist", `shape` for "what's the structure", `sample` for "show me one realistic record", `json_schema` for downstream tooling.

## jq cheatsheet

```jq
# Pick specific fields              .data | map({id, name})
# Drop heavy fields                 .data | map(del(.payload, .raw_html))
# Filter rows                       .data | map(select(.role == "admin"))
# Filter + pick                     .data | map(select(.active) | {id, email})
# First N                           .data[:5]
# Pluck single value                .meta.total
# Pagination cursor                 .meta.next_cursor // empty
# Group by                          .data | group_by(.tag) | map({tag: .[0].tag, n: length})
# Stats                             .data | length, (map(.score) | add / length)
# Errors only                       .results | map(select(.error))
# Flatten nested                    [.. | objects | select(.id?) | {id, type}]
# Search by substring               .items | map(select(.title | test("regex"; "i")))
# Sort + take top N                 .events | sort_by(.created_at) | reverse | .[:10]
```

`output_mode: "all"` (default) returns single-output filters as their value, multi-output filters as an array. `output_mode: "first"` collapses to the first emitted value.

## Real-world examples

### 1. Explore an unknown REST endpoint

```
http_request {method: "GET", url: "https://api.someservice.io/v1/widgets"}
  → schema (paths) shows what's there: data[].id, data[].name, meta.next_cursor, …
http_read {cache_id, mask: ".data | map({id, name})"}
  → just the slice you need
```

### 2. Pull only `id` and `created_at` from GitHub issues

```
http_request {
  method: "GET",
  url: "https://api.github.com/repos/anthropics/claude-cookbooks/issues",
  headers: {accept: "application/vnd.github+json"}
}
http_read {cache_id, mask: ".[] | {id, created_at}"}
```

### 3. Upload an image via multipart

```
http_request {
  method: "POST",
  url: "https://upload.example.com/photos",
  headers: {authorization: "Bearer …"},
  multipart: { files: { photo: { path: "/host/photo.jpg", content_type: "image/jpeg" } } }
}
```

For remote-MCP setups (or any time a server-side path makes no sense), use the inline variant — bytes travel in the JSON-RPC frame, no `MAGPIE_FILES_ROOT` constraint applies:

```
http_request {
  method: "POST",
  url: "https://upload.example.com/photos",
  multipart: { files: { photo: {
    content_base64: "<base64 bytes>",
    filename: "photo.jpg",
    content_type: "image/jpeg"
  } } }
}
```

Inline payloads are capped at `MAGPIE_MAX_INLINE_FILE_BYTES` (10 MB pre-base64 by default).

### 4. Stream a binary download to disk

```
http_request {
  method: "GET",
  url: "https://example.com/big.zip",
  download_to: "/tmp/big.zip"
}
  → response is never buffered in agent context; sha256 + byte count returned
```

## Configuration

All env vars are optional. Defaults match common-sense limits.

| Env var | Default | Purpose |
|---|---|---|
| `MAGPIE_DEFAULT_TIMEOUT_MS` | 30000 | per-request HTTP timeout |
| `MAGPIE_MAX_RESPONSE_BYTES` | 52428800 | hard cap on cached body size (50 MB) |
| `MAGPIE_CACHE_TTL_SECONDS` | 600 | cache entry lifetime (10 min) |
| `MAGPIE_INLINE_THRESHOLD_BYTES` | 8192 | `body_mode: "auto"` upgrades to `inline` below this |
| `MAGPIE_HEAD_PREVIEW_THRESHOLD` | 65536 | `body_mode: "auto"` upgrades to `head` below this; otherwise `schema` |
| `MAGPIE_HEAD_PREVIEW_ITEMS` | 5 | array items kept verbatim in `body_preview` (rest collapsed) |
| `MAGPIE_HEAD_PREVIEW_STRING` | 200 | string truncation length in `body_preview` |
| `MAGPIE_INLINE_BODY_CAP` | 262144 | hard cap on `body_mode: "inline"` (256 KB) |
| `MAGPIE_MAX_INLINE_FILE_BYTES` | 10485760 | hard cap on `multipart.files[].content_base64` (10 MB pre-base64) |
| `MAGPIE_JQ_TIMEOUT_MS` | 5000 | per-mask jq timeout |
| `MAGPIE_USE_NATIVE_JQ` | 0 | switch to subprocess jq (reserved, not heavily exercised) |
| `MAGPIE_TLS_INSECURE` | 0 | skip TLS verification |
| `MAGPIE_SCHEMA_MAX_DEPTH` | 10 | recursion depth for schema renderers |
| `MAGPIE_SCHEMA_MAX_OBJECT_KEYS` | 200 | per-object key cap |
| `MAGPIE_SCHEMA_SAMPLE_MAX_STRING` | 100 | string truncation in samples |
| `MAGPIE_FILES_ROOT` | _(unset)_ | restricts `multipart.files[].path`, `download_to`, and `save_to` to canonical paths under this prefix; unset means no constraint. Does **not** apply to `multipart.files[].content_base64` (no path involved) |

## How much context does this actually save?

Approximate token costs for a single agent turn that wants *one slice* of a real-world API response. Tokenizer-dependent (Anthropic Claude tokens, English-heavy JSON, ~4 chars/token); your numbers will vary by ±30%.

| Endpoint | Raw response | Raw tokens | Magpie schema | Magpie tokens | Savings |
|---|---:|---:|---:|---:|---:|
| GitHub Issues — `GET /repos/X/Y/issues` (page of 30) | ~200 KB | ~12 000 | ~1 KB | ~250 | **~48×** |
| Stripe Charges — `GET /v1/charges?limit=10` | ~80 KB | ~5 000 | ~0.6 KB | ~150 | **~33×** |
| OpenWeather — `GET /data/2.5/forecast` (5 day / 3 h, 40 entries) | ~30 KB | ~2 000 | ~0.5 KB | ~120 | **~17×** |

Once the agent has the schema, `http_read {cache_id, mask: "..."}` returns just the slice — typically a handful of tokens.

## Compared to alternatives

| | `rest-magpie` | `fetch-mcp` | `curl + jq` |
|---|:---:|:---:|:---:|
| All HTTP methods | ✅ | ❌ | ✅ |
| Custom headers | ✅ | ✅ | ✅ |
| Multipart file uploads | ✅ | ❌ | ✅ |
| Schema-first responses | ✅ | ❌ | ❌ |
| Field filtering (jq) | ✅ | ❌ | manual |
| Doesn't dump 200KB into agent context | ✅ | ❌ | ❌ |
| Single permission grant (no per-call prompt) | ✅ | ✅ | ❌ |

## License

MIT — see [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch naming, conventional-commit style, and the PR flow. Bug reports and feature ideas go in [GitHub Issues](https://github.com/ed-smartass/rest-magpie/issues).
