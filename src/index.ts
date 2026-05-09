import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { getConfig } from './config.js'
import { Cache } from './core/cache.js'
import { httpInspectTool } from './tools/http_inspect.js'
import { httpReadTool } from './tools/http_read.js'
import { httpRequestTool } from './tools/http_request.js'

// Replaced by tsup at build time (see tsup.config.ts `define`). Falls back to
// process.env.npm_package_version when running under npm scripts (tests).
declare const __MAGPIE_VERSION__: string | undefined
const VERSION =
    typeof __MAGPIE_VERSION__ !== 'undefined'
        ? __MAGPIE_VERSION__
        : (process.env.npm_package_version ?? '0.0.0-dev')

export const createServer = () => {
    const cfg = getConfig()
    const cache = new Cache(cfg.cacheTtlSeconds)
    const filesNote = cfg.filesRoot
        ? ' Server-side file paths (multipart.files[].path, download_to, save_to) must reside under ' +
          cfg.filesRoot +
          '.'
        : ''
    const server = new Server(
        { name: 'rest-magpie', version: VERSION },
        { capabilities: { tools: {} } },
    )

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: 'http_request',
                description: HTTP_REQUEST_DESC + filesNote,
                inputSchema: HTTP_REQUEST_SCHEMA,
            },
            {
                name: 'http_read',
                description: HTTP_READ_DESC + filesNote,
                inputSchema: HTTP_READ_SCHEMA,
            },
            {
                name: 'http_inspect',
                description: HTTP_INSPECT_DESC,
                inputSchema: HTTP_INSPECT_SCHEMA,
            },
        ],
    }))

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const { name, arguments: args } = req.params
        const a = args ?? {}
        let result: unknown
        if (name === 'http_request') {
            result = await httpRequestTool(a as never, cache)
        } else if (name === 'http_read') {
            result = await httpReadTool(a as never, cache)
        } else if (name === 'http_inspect') {
            result = await httpInspectTool(a as never, cache)
        } else {
            throw new Error('unknown tool: ' + name)
        }
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    })

    return { server, cache }
}

const HTTP_REQUEST_DESC =
    'Perform an HTTP request and return a compact schema of the response, not the full body.\n\n' +
    'Default flow (use this for any non-trivial response): ' +
    '(1) call http_request to get { schema, cache_id }; ' +
    '(2) call http_read with cache_id and a jq mask to extract only the field(s) you need. ' +
    'This keeps your context small even on multi-MB responses.\n\n' +
    'body_mode controls how much of the body comes back inline:\n' +
    '  schema (no body — schema only)\n' +
    '  head   (schema + truncated preview of arrays/strings — middle ground)\n' +
    '  inline (schema + full body — costly; capped by MAGPIE_INLINE_BODY_CAP)\n' +
    '  auto   (default — server picks based on byte thresholds)\n' +
    'Reach for inline ONLY when body is known-small AND every field is needed; ' +
    'a 200KB JSON inlined is ~12K tokens of context for data you may never use.\n\n' +
    'Multipart uploads stream files via chunked transfer encoding (no Content-Length). ' +
    'Most servers accept this; some legacy proxies / primitive test servers reject it.\n\n' +
    'Cookbook:\n' +
    '  • Explore an unknown endpoint:\n' +
    '      http_request {method: "GET", url}  →  schema shows what is there\n' +
    '      http_read {cache_id, mask: ".data | map({id, name})"}\n' +
    '  • Top 10 GitHub issues by comment count:\n' +
    '      http_request {method: "GET", url: "https://api.github.com/repos/OWNER/REPO/issues"}\n' +
    '      http_read {cache_id, mask: "sort_by(-.comments)[:10] | .[] | {id, title, comments}"}'

const HTTP_READ_DESC =
    'Read a cached response body, optionally filtered through a jq mask. ' +
    'Tip: lead with `length` (e.g. mask: ".data | length") to learn the size before listing items. ' +
    'Required for binary bodies — pass save_to to stream the body to disk; binaries are never inlined into your context.'

const HTTP_INSPECT_DESC =
    'Re-render the cached response schema in a different format (paths | shape | sample | json_schema) ' +
    'without making a second HTTP call. ' +
    'Try `shape` for nested structures, `sample` to see one realistic record, or `json_schema` for downstream typed pipelines.'

// JSON Schemas — order of properties matches the spec §4 canonical order.
const HTTP_REQUEST_SCHEMA = {
    type: 'object',
    properties: {
        method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
        },
        url: { type: 'string', description: 'Absolute URL.' },
        query: {
            type: 'object',
            additionalProperties: {
                oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
            },
        },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        body: {
            description:
                'Object → JSON; string → text/plain; mutually exclusive with body_raw and multipart.',
        },
        body_raw: { type: 'string', description: 'Raw payload; pair with content_type.' },
        multipart: {
            type: 'object',
            properties: {
                fields: { type: 'object', additionalProperties: { type: 'string' } },
                files: {
                    type: 'object',
                    additionalProperties: {
                        type: 'object',
                        properties: {
                            path: { type: 'string' },
                            filename: { type: 'string' },
                            content_type: { type: 'string' },
                        },
                        required: ['path'],
                    },
                },
            },
        },
        content_type: { type: 'string', description: 'Override Content-Type.' },
        timeout_ms: { type: 'integer', description: 'Default 30000.' },
        follow_redirects: { type: 'boolean', description: 'Default true (max 10 hops).' },
        tls_insecure: { type: 'boolean', description: 'Default false.' },
        schema_format: {
            type: 'string',
            enum: ['paths', 'shape', 'sample', 'json_schema'],
            description: "Default 'paths'.",
        },
        body_mode: {
            type: 'string',
            enum: ['auto', 'schema', 'head', 'inline'],
            description: "Default 'auto'. schema | head | inline | auto.",
        },
        download_to: { type: 'string', description: 'Stream body to file (skips cache).' },
    },
    required: ['method', 'url'],
}

const HTTP_READ_SCHEMA = {
    type: 'object',
    properties: {
        cache_id: { type: 'string' },
        mask: { type: 'string', description: 'jq expression; valid only for JSON bodies.' },
        output_mode: {
            type: 'string',
            enum: ['first', 'all'],
            description: "Default 'all'.",
        },
        save_to: { type: 'string', description: 'Required for binary bodies.' },
    },
    required: ['cache_id'],
}

const HTTP_INSPECT_SCHEMA = {
    type: 'object',
    properties: {
        cache_id: { type: 'string' },
        schema_format: { type: 'string', enum: ['paths', 'shape', 'sample', 'json_schema'] },
    },
    required: ['cache_id', 'schema_format'],
}

// Bootstrap when run directly. argv[1] may be a symlink (npx/.bin/rest-magpie),
// so resolve to the real file before comparing with import.meta.url.
const isMain = (() => {
    const argv1 = process.argv[1]
    if (!argv1) return false
    try {
        return import.meta.url === pathToFileURL(realpathSync(argv1)).href
    } catch {
        return false
    }
})()
if (isMain) {
    const { server } = createServer()
    const transport = new StdioServerTransport()
    server.connect(transport).catch((e) => {
        console.error('rest-magpie failed to start:', e)
        process.exit(1)
    })
}
