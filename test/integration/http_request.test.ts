import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { resetConfigCache } from '../../src/config.js'
import { Cache } from '../../src/core/cache.js'
import { isError } from '../../src/core/errors.js'
import { httpRequestTool } from '../../src/tools/http_request.js'

const server = setupServer()
beforeAll(() => server.listen())
afterEach(() => {
    server.resetHandlers()
    resetConfigCache()
})
afterAll(() => server.close())

describe('http_request tool', () => {
    it('returns cache_id, status, meta, schema for JSON', async () => {
        server.use(http.get('https://api.test/u', () => HttpResponse.json({ data: [{ id: 1 }] })))
        const cache = new Cache(60)
        const r = await httpRequestTool({ method: 'GET', url: 'https://api.test/u' }, cache)
        expect(isError(r)).toBe(false)
        if (isError(r)) return
        expect(r.status).toBe(200)
        expect(r.cache_id).toMatch(/^req_/)
        expect(typeof r.schema).toBe('string')
        expect(r.meta.body_kind).toBe('json')
        expect(r.meta.body_inclusion.resolved_mode).toBe('inline')
        expect(r.body).toEqual({ data: [{ id: 1 }] })
    })

    it('auto resolves to head when body is between thresholds', async () => {
        const k1 = 'MAGPIE_INLINE_THRESHOLD_BYTES'
        process.env[k1] = '10'
        resetConfigCache()
        server.use(
            http.get('https://api.test/big', () => HttpResponse.json({ a: 'x'.repeat(100) })),
        )
        const cache = new Cache(60)
        const r = await httpRequestTool({ method: 'GET', url: 'https://api.test/big' }, cache)
        if (isError(r)) throw new Error('unexpected error')
        expect(r.meta.body_inclusion.resolved_mode).toBe('head')
        expect(r.body).toBeUndefined()
        delete process.env[k1]
    })

    it('forces body_mode=inline regardless of size (json)', async () => {
        server.use(http.get('https://api.test/x', () => HttpResponse.json({ a: 1 })))
        const cache = new Cache(60)
        const r = await httpRequestTool(
            { method: 'GET', url: 'https://api.test/x', body_mode: 'inline' },
            cache,
        )
        if (isError(r)) throw new Error('unexpected error')
        expect(r.body).toEqual({ a: 1 })
    })

    it('rejects body_mode=inline on binary', async () => {
        server.use(
            http.get(
                'https://api.test/b',
                () =>
                    new Response(new Uint8Array([1, 2, 3]), {
                        headers: { 'content-type': 'image/png' },
                    }),
            ),
        )
        const cache = new Cache(60)
        const r = await httpRequestTool(
            { method: 'GET', url: 'https://api.test/b', body_mode: 'inline' },
            cache,
        )
        expect(isError(r)).toBe(true)
        if (isError(r)) {
            expect(r.error.kind).toBe('invalid_input')
            // Non-cap resolution errors do not advertise a recovery path,
            // so cache_id must NOT leak into detail and nothing should be
            // in the cache.
            expect(r.error.detail?.cache_id).toBeUndefined()
        }
        expect(cache.size()).toBe(0)
    })

    it('auto on binary resolves to schema and never inlines', async () => {
        server.use(
            http.get(
                'https://api.test/b',
                () =>
                    new Response(new Uint8Array([1, 2, 3]), {
                        headers: { 'content-type': 'image/png' },
                    }),
            ),
        )
        const cache = new Cache(60)
        const r = await httpRequestTool({ method: 'GET', url: 'https://api.test/b' }, cache)
        if (isError(r)) throw new Error('unexpected error')
        expect(r.meta.body_inclusion.resolved_mode).toBe('schema')
        expect(r.body).toBeUndefined()
    })

    it('rejects download_to + body_mode=inline', async () => {
        const cache = new Cache(60)
        const r = await httpRequestTool(
            {
                method: 'GET',
                url: 'https://api.test/x',
                download_to: '/tmp/y',
                body_mode: 'inline',
            },
            cache,
        )
        expect(isError(r)).toBe(true)
        if (isError(r)) expect(r.error.kind).toBe('invalid_input')
    })

    it('rejects legacy include_body field with unsupported_field', async () => {
        const cache = new Cache(60)
        // biome-ignore lint/suspicious/noExplicitAny: simulating legacy v0.1.x caller
        const params: any = { method: 'GET', url: 'https://api.test/x', include_body: true }
        const r = await httpRequestTool(params, cache)
        expect(isError(r)).toBe(true)
        if (isError(r)) {
            expect(r.error.kind).toBe('unsupported_field')
            expect(r.error.message).toContain('body_mode')
        }
    })

    it('errors body_too_large_for_inline when explicit inline > cap, surfaces cache_id, body retrievable', async () => {
        process.env.MAGPIE_INLINE_BODY_CAP = '10'
        resetConfigCache()
        server.use(http.get('https://api.test/q', () => HttpResponse.json({ s: 'x'.repeat(200) })))
        const cache = new Cache(60)
        const r = await httpRequestTool(
            { method: 'GET', url: 'https://api.test/q', body_mode: 'inline' },
            cache,
        )
        expect(isError(r)).toBe(true)
        if (isError(r)) {
            expect(r.error.kind).toBe('body_too_large_for_inline')
            // The error message tells the agent to recover via http_read with
            // the surfaced cache_id, so the cache_id must actually be in the
            // detail and the entry must be in the cache.
            const cache_id = r.error.detail?.cache_id as string | undefined
            expect(typeof cache_id).toBe('string')
            expect(cache_id).toMatch(/^req_/)
            const entry = cache.get(cache_id as string)
            expect(entry).toBeDefined()
            expect(entry?.body).toEqual({ s: 'x'.repeat(200) })
        }
        Reflect.deleteProperty(process.env, 'MAGPIE_INLINE_BODY_CAP')
    })

    describe('with MAGPIE_FILES_ROOT', () => {
        const key = 'MAGPIE_FILES_ROOT'

        afterEach(() => {
            delete process.env[key]
            resetConfigCache()
        })

        it('rejects download_to outside the root', async () => {
            process.env[key] = '/tmp/magpie-data'
            resetConfigCache()
            const cache = new Cache(60)
            const r = await httpRequestTool(
                { method: 'GET', url: 'https://api.test/x', download_to: '/tmp/elsewhere/out.bin' },
                cache,
            )
            expect(isError(r)).toBe(true)
            if (isError(r)) {
                expect(r.error.kind).toBe('invalid_input')
                expect(r.error.message).toContain('/tmp/magpie-data')
                expect(r.error.message).toContain('download_to')
            }
        })

        it('rejects multipart file path outside the root', async () => {
            process.env[key] = '/tmp/magpie-data'
            resetConfigCache()
            const cache = new Cache(60)
            const r = await httpRequestTool(
                {
                    method: 'POST',
                    url: 'https://api.test/upload',
                    multipart: { files: { photo: { path: '/etc/passwd' } } },
                },
                cache,
            )
            expect(isError(r)).toBe(true)
            if (isError(r)) {
                expect(r.error.kind).toBe('invalid_input')
                expect(r.error.message).toContain('photo')
            }
        })

        it('rejects path traversal escape via ..', async () => {
            process.env[key] = '/tmp/magpie-data'
            resetConfigCache()
            const cache = new Cache(60)
            const r = await httpRequestTool(
                {
                    method: 'GET',
                    url: 'https://api.test/x',
                    download_to: '/tmp/magpie-data/../../etc/shadow',
                },
                cache,
            )
            expect(isError(r)).toBe(true)
            if (isError(r)) expect(r.error.kind).toBe('invalid_input')
        })

        it('allows download_to under the root', async () => {
            process.env[key] = '/tmp/magpie-data'
            resetConfigCache()
            server.use(
                http.get(
                    'https://api.test/file',
                    () =>
                        new Response('hello', {
                            headers: { 'content-type': 'application/octet-stream' },
                        }),
                ),
            )
            const cache = new Cache(60)
            const fs = await import('node:fs')
            fs.mkdirSync('/tmp/magpie-data', { recursive: true })
            const r = await httpRequestTool(
                {
                    method: 'GET',
                    url: 'https://api.test/file',
                    download_to: '/tmp/magpie-data/out.bin',
                },
                cache,
            )
            expect(isError(r)).toBe(false)
            fs.rmSync('/tmp/magpie-data/out.bin', { force: true })
        })

        it('does not constrain when MAGPIE_FILES_ROOT is unset', async () => {
            const cache = new Cache(60)
            // Even though /tmp/anywhere isn't restricted, the actual fetch will fail
            // for unrelated reasons (no msw handler) — we only care that the validation
            // step does NOT block; classifyHttpError will surface the network failure.
            server.use(
                http.get(
                    'https://api.test/anywhere',
                    () =>
                        new Response('ok', {
                            headers: { 'content-type': 'application/octet-stream' },
                        }),
                ),
            )
            const r = await httpRequestTool(
                {
                    method: 'GET',
                    url: 'https://api.test/anywhere',
                    download_to: '/tmp/anywhere-' + Date.now() + '.bin',
                },
                cache,
            )
            // Should NOT be invalid_input from files_root validation (any other outcome is fine).
            if (isError(r)) {
                expect(r.error.kind).not.toBe('invalid_input')
            }
        })
    })
})
