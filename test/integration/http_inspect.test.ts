import { describe, expect, it } from 'vitest'
import { Cache } from '../../src/core/cache.js'
import { isError } from '../../src/core/errors.js'
import { httpInspectTool } from '../../src/tools/http_inspect.js'
import type { CacheEntry } from '../../src/types.js'

const makeEntry = (cache: Cache, body: unknown): string => {
    const id = cache.newId()
    const e: CacheEntry = {
        cache_id: id,
        created_at: Date.now(),
        body_kind: 'json',
        body,
        status: 200,
        meta: {
            url: 'u',
            method: 'GET',
            duration_ms: 0,
            response_headers: {},
            body_bytes: JSON.stringify(body).length,
            content_type: 'application/json',
            body_kind: 'json',
            body_inclusion: {
                resolved_mode: 'schema',
                inline_threshold_bytes: 8192,
                head_preview_threshold_bytes: 65536,
                head_preview_items: 5,
                head_preview_string_chars: 200,
                inline_cap_bytes: 262144,
            },
            redirect_chain: [],
        },
    }
    cache.put(e)
    return id
}

describe('http_inspect', () => {
    it('re-renders schema in another format', async () => {
        const cache = new Cache(60)
        const id = makeEntry(cache, { a: 1 })
        const r = await httpInspectTool({ cache_id: id, schema_format: 'json_schema' }, cache)
        if (isError(r)) throw new Error()
        expect(typeof r.schema).toBe('object')
    })

    it('returns cache_miss for unknown id', async () => {
        const cache = new Cache(60)
        const r = await httpInspectTool({ cache_id: 'req_x', schema_format: 'paths' }, cache)
        expect(isError(r)).toBe(true)
    })
})
