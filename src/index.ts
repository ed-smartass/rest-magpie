import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { getConfig } from './config.js'
import { Cache } from './core/cache.js'
import { httpInspectTool } from './tools/http_inspect.js'
import { httpReadTool } from './tools/http_read.js'
import { httpRequestTool } from './tools/http_request.js'

export const createServer = () => {
    const cfg = getConfig()
    const cache = new Cache(cfg.cacheTtlSeconds)
    const filesNote = cfg.filesRoot
        ? ' Server-side file paths (multipart.files[].path, download_to, save_to) must reside under ' +
          cfg.filesRoot +
          '.'
        : ''
    const server = new Server(
        { name: 'rest-magpie', version: '0.1.0' },
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
    'Perform an HTTP request, cache the response, and return a schema of the body. ' +
    'By default, only the schema is returned (small bodies <=8KB are inlined). ' +
    'Use http_read to extract fields with a jq mask.'
const HTTP_READ_DESC =
    'Read a cached response body. Optionally apply a jq mask. Required for binary bodies (use save_to).'
const HTTP_INSPECT_DESC =
    'Re-render the cached response schema in a different format without re-fetching.'

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
        include_body: {
            description: "true | false | 'auto' (default).",
            oneOf: [{ type: 'boolean' }, { type: 'string', enum: ['auto'] }],
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

// Bootstrap when run directly.
if (import.meta.url === 'file://' + process.argv[1]) {
    const { server } = createServer()
    const transport = new StdioServerTransport()
    server.connect(transport).catch((e) => {
        console.error('rest-magpie failed to start:', e)
        process.exit(1)
    })
}
