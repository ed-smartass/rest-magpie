# rest-magpie

> REST that picks only the shiny bits.

`rest-magpie` is an MCP server that wraps arbitrary REST API calls with a **schema-first** response model and **jq-based** field extraction. Big API responses no longer blow your agent's context — the agent first sees a compact schema, then pulls only what it asked for.

## Why

- **Schema-first.** The default response is a structural summary (`paths`, `shape`, `sample`, or `json_schema`), not the body.
- **jq filtering.** Agents extract exactly the fields they need from the cached body.
- **Cached.** Re-rendering schemas or pulling slices doesn't cost a second HTTP call.

## Install

**npm (recommended):**
```jsonc
// claude_desktop_config.json or any MCP-compatible client config
{
  "mcpServers": {
    "rest-magpie": {
      "command": "npx",
      "args": ["-y", "rest-magpie"]
    }
  }
}
```

**Docker:**
```jsonc
{
  "mcpServers": {
    "rest-magpie": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "/host/uploads:/uploads:ro",
        "ghcr.io/ed-smartass/rest-magpie:latest"
      ]
    }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `http_request` | Run an HTTP request; cache the body; return schema (and optionally the body for small responses). |
| `http_read` | Read a cached body, optionally filtered by a jq mask. |
| `http_inspect` | Re-render the cached body's schema in another format. |

## Schema formats

Request the same `/users` endpoint with all four formats:

**`paths` (default):**
```
data[].id            : int    (e.g. 42)
data[].name          : string (e.g. "alice")
meta.total           : int    (e.g. 1247)

# 187 KB · data[]: 50 items
```

**`shape`:**
```
{
  data: [{ id: int, name: string }] (50 items),
  meta: { total: int }
}
# 187 KB
```

**`sample`:** first item full, rest replaced.

**`json_schema`:** standard JSON Schema (draft 2020-12).

## jq cheatsheet

```
# Pick fields:           .data | map({id, name})
# Filter:                .data | map(select(.role == "admin"))
# Pluck a single value:  .meta.total
# Group:                 .data | group_by(.role) | map({role: .[0].role, count: length})
# Length:                .data | length
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `MAGPIE_DEFAULT_TIMEOUT_MS` | 30000 | per-request HTTP timeout |
| `MAGPIE_MAX_RESPONSE_BYTES` | 52428800 | hard cap on cached body size |
| `MAGPIE_CACHE_TTL_SECONDS` | 600 | cache entry lifetime |
| `MAGPIE_AUTO_INCLUDE_BODY_BYTES` | 8192 | threshold for `include_body: "auto"` |
| `MAGPIE_JQ_TIMEOUT_MS` | 5000 | per-mask jq timeout |
| `MAGPIE_USE_NATIVE_JQ` | 0 | switch to subprocess jq |
| `MAGPIE_TLS_INSECURE` | 0 | skip TLS verification |
| `MAGPIE_SCHEMA_MAX_DEPTH` | 10 | recursion depth for schema renderers |
| `MAGPIE_SCHEMA_MAX_OBJECT_KEYS` | 200 | per-object key cap |
| `MAGPIE_SCHEMA_SAMPLE_MAX_STRING` | 100 | string truncation in samples |

## Compared to alternatives

| | `rest-magpie` | `fetch-mcp` | `curl` |
|---|---|---|---|
| All HTTP methods | ✅ | ❌ | ✅ |
| Custom headers | ✅ | ✅ | ✅ |
| Multipart | ✅ | ❌ | ✅ |
| Schema-first | ✅ | ❌ | ❌ |
| Field filtering (jq) | ✅ | ❌ | manual |
| Single permission grant | ✅ | ✅ | ❌ |

## License

MIT
