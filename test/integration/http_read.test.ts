import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Cache } from '../../src/core/cache.js'
import { isError } from '../../src/core/errors.js'
import { httpReadTool } from '../../src/tools/http_read.js'
import type { CacheEntry } from '../../src/types.js'

const makeJsonEntry = (cache: Cache, body: unknown): string => {
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
                inline_body_cap_bytes: 262144,
            },
            redirect_chain: [],
        },
    }
    cache.put(e)
    return id
}

describe('http_read', () => {
    it('returns full body when no mask', async () => {
        const cache = new Cache(60)
        const id = makeJsonEntry(cache, { x: 1 })
        const r = await httpReadTool({ cache_id: id }, cache)
        if (isError(r)) throw new Error()
        expect(r.result).toEqual({ x: 1 })
    })

    it('applies jq mask', async () => {
        const cache = new Cache(60)
        const id = makeJsonEntry(cache, { data: [{ id: 1 }, { id: 2 }] })
        const r = await httpReadTool({ cache_id: id, mask: '.data | map(.id)' }, cache)
        if (isError(r)) throw new Error()
        expect(r.result).toEqual([1, 2])
    })

    it('respects output_mode=first', async () => {
        const cache = new Cache(60)
        const id = makeJsonEntry(cache, { data: [10, 20] })
        const r = await httpReadTool({ cache_id: id, mask: '.data[]', output_mode: 'first' }, cache)
        if (isError(r)) throw new Error()
        expect(r.result).toBe(10)
    })

    it('returns cache_miss for unknown id', async () => {
        const cache = new Cache(60)
        const r = await httpReadTool({ cache_id: 'req_unknown' }, cache)
        expect(isError(r)).toBe(true)
        if (isError(r)) expect(r.error.kind).toBe('cache_miss')
    })

    it('mask_not_applicable for non-json with mask', async () => {
        const cache = new Cache(60)
        const id = cache.newId()
        cache.put({
            cache_id: id,
            created_at: Date.now(),
            body_kind: 'text',
            body: 'hi',
            status: 200,
            meta: {
                url: 'u',
                method: 'GET',
                duration_ms: 0,
                response_headers: {},
                body_bytes: 2,
                content_type: 'text/plain',
                body_kind: 'text',
                body_inclusion: {
                    resolved_mode: 'schema',
                    inline_threshold_bytes: 8192,
                    head_preview_threshold_bytes: 65536,
                    head_preview_items: 5,
                    head_preview_string_chars: 200,
                    inline_body_cap_bytes: 262144,
                },
                redirect_chain: [],
            },
        })
        const r = await httpReadTool({ cache_id: id, mask: '.' }, cache)
        expect(isError(r)).toBe(true)
        if (isError(r)) expect(r.error.kind).toBe('mask_not_applicable')
    })

    it('save_to writes binary body', async () => {
        const cache = new Cache(60)
        const id = cache.newId()
        cache.put({
            cache_id: id,
            created_at: Date.now(),
            body_kind: 'binary',
            body: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
            status: 200,
            meta: {
                url: 'u',
                method: 'GET',
                duration_ms: 0,
                response_headers: {},
                body_bytes: 4,
                content_type: 'application/octet-stream',
                body_kind: 'binary',
                body_inclusion: {
                    resolved_mode: 'schema',
                    inline_threshold_bytes: 8192,
                    head_preview_threshold_bytes: 65536,
                    head_preview_items: 5,
                    head_preview_string_chars: 200,
                    inline_body_cap_bytes: 262144,
                },
                redirect_chain: [],
            },
        })
        const dir = mkdtempSync(join(tmpdir(), 'peek-save-'))
        const p = join(dir, 'out.bin')
        const r = await httpReadTool({ cache_id: id, save_to: p }, cache)
        if (isError(r)) throw new Error()
        expect(r.result).toMatchObject({ saved_to: p, byte_count: 4 })
        expect(readFileSync(p).toString('hex')).toBe('deadbeef')
    })

    it('rejects save_to outside PEEK_FILES_ROOT', async () => {
        const key = 'PEEK_FILES_ROOT'
        process.env[key] = '/tmp/peek-data'
        const { resetConfigCache } = await import('../../src/config.js')
        resetConfigCache()

        const cache = new Cache(60)
        const id = cache.newId()
        cache.put({
            cache_id: id,
            created_at: Date.now(),
            body_kind: 'binary',
            body: Buffer.from([0x01]),
            status: 200,
            meta: {
                url: 'u',
                method: 'GET',
                duration_ms: 0,
                response_headers: {},
                body_bytes: 1,
                content_type: 'application/octet-stream',
                body_kind: 'binary',
                body_inclusion: {
                    resolved_mode: 'schema',
                    inline_threshold_bytes: 8192,
                    head_preview_threshold_bytes: 65536,
                    head_preview_items: 5,
                    head_preview_string_chars: 200,
                    inline_body_cap_bytes: 262144,
                },
                redirect_chain: [],
            },
        })
        const r = await httpReadTool({ cache_id: id, save_to: '/etc/evil.bin' }, cache)
        expect(isError(r)).toBe(true)
        if (isError(r)) {
            expect(r.error.kind).toBe('invalid_input')
            expect(r.error.message).toContain('save_to')
            expect(r.error.message).toContain('/tmp/peek-data')
        }

        delete process.env[key]
        resetConfigCache()
    })
})
