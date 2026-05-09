import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Cache } from '../../src/core/cache.js'
import type { CacheEntry } from '../../src/types.js'

const sampleEntry = (cache_id: string): CacheEntry => ({
    cache_id,
    created_at: Date.now(),
    body_kind: 'json',
    body: { hello: 'world' },
    status: 200,
    meta: {
        url: 'https://example.com',
        method: 'GET',
        duration_ms: 10,
        response_headers: {},
        body_bytes: 18,
        content_type: 'application/json',
        body_kind: 'json',
        body_inclusion: {
            resolved_mode: 'inline',
            inline_threshold_bytes: 8192,
            head_preview_threshold_bytes: 65536,
            head_preview_items: 5,
            head_preview_string_chars: 200,
            inline_body_cap_bytes: 262144,
        },
        redirect_chain: [],
    },
})

describe('Cache', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('stores and retrieves entries by id', () => {
        const c = new Cache(60)
        c.put(sampleEntry('a'))
        expect(c.get('a')?.cache_id).toBe('a')
        expect(c.get('missing')).toBeUndefined()
    })

    it('auto-evicts after TTL', () => {
        const c = new Cache(60)
        c.put(sampleEntry('a'))
        expect(c.get('a')).toBeDefined()
        vi.advanceTimersByTime(60 * 1000 + 1)
        expect(c.get('a')).toBeUndefined()
    })

    it('does not slide TTL on access', () => {
        const c = new Cache(60)
        c.put(sampleEntry('a'))
        vi.advanceTimersByTime(50 * 1000)
        expect(c.get('a')).toBeDefined()
        vi.advanceTimersByTime(11 * 1000)
        expect(c.get('a')).toBeUndefined()
    })

    it('manual delete clears entry and timer', () => {
        const c = new Cache(60)
        c.put(sampleEntry('a'))
        c.delete('a')
        expect(c.get('a')).toBeUndefined()
        vi.advanceTimersByTime(60 * 1000 + 1)
        // No throw, no errors after timer would have fired.
        expect(c.size()).toBe(0)
    })

    it('generates unique ids via newId()', () => {
        const c = new Cache(60)
        const a = c.newId()
        const b = c.newId()
        expect(a).not.toBe(b)
        expect(a).toMatch(/^req_[a-z0-9]+$/)
    })
})
