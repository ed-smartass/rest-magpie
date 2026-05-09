import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { performHttp } from '../../src/core/http.js'

const server = setupServer()
beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('performHttp', () => {
    it('performs GET and returns parsed body', async () => {
        server.use(http.get('https://api.test/users', () => HttpResponse.json({ ok: true })))
        const r = await performHttp({ method: 'GET', url: 'https://api.test/users' }, {})
        expect(r.status).toBe(200)
        expect(r.body_kind).toBe('json')
        expect(r.parsedBody).toEqual({ ok: true })
    })

    it('merges query params into URL', async () => {
        let received: URL | undefined
        server.use(
            http.get('https://api.test/search', ({ request }) => {
                received = new URL(request.url)
                return HttpResponse.json({})
            }),
        )
        await performHttp(
            { method: 'GET', url: 'https://api.test/search', query: { q: 'hi', tag: ['a', 'b'] } },
            {},
        )
        expect(received?.searchParams.get('q')).toBe('hi')
        expect(received?.searchParams.getAll('tag')).toEqual(['a', 'b'])
    })

    it('sends custom headers', async () => {
        let auth: string | null = null
        server.use(
            http.get('https://api.test/me', ({ request }) => {
                auth = request.headers.get('authorization')
                return HttpResponse.json({})
            }),
        )
        await performHttp(
            { method: 'GET', url: 'https://api.test/me', headers: { authorization: 'Bearer x' } },
            {},
        )
        expect(auth).toBe('Bearer x')
    })

    it('classifies binary response', async () => {
        server.use(
            http.get(
                'https://api.test/bin',
                () =>
                    new Response(new Uint8Array([1, 2, 3]), {
                        headers: { 'content-type': 'image/png' },
                    }),
            ),
        )
        const r = await performHttp({ method: 'GET', url: 'https://api.test/bin' }, {})
        expect(r.body_kind).toBe('binary')
        expect((r.parsedBody as Buffer).length).toBe(3)
    })

    it('returns invalid_url for malformed URL', async () => {
        await expect(performHttp({ method: 'GET', url: 'not-a-url' }, {})).rejects.toThrow(
            /invalid_url/,
        )
    })
})

describe('performHttp body input', () => {
    it('encodes object body as application/json', async () => {
        let received: { body: unknown; ct: string | null } = { body: undefined, ct: null }
        server.use(
            http.post('https://api.test/echo', async ({ request }) => {
                received = { body: await request.json(), ct: request.headers.get('content-type') }
                return HttpResponse.json({ ok: true })
            }),
        )
        await performHttp({ method: 'POST', url: 'https://api.test/echo', body: { x: 1 } }, {})
        expect(received.body).toEqual({ x: 1 })
        expect(received.ct).toContain('application/json')
    })

    it('sends string body as text/plain when no content_type', async () => {
        let body: string | undefined
        let ct: string | null = null
        server.use(
            http.post('https://api.test/raw', async ({ request }) => {
                body = await request.text()
                ct = request.headers.get('content-type')
                return HttpResponse.json({})
            }),
        )
        await performHttp({ method: 'POST', url: 'https://api.test/raw', body: 'hello' }, {})
        expect(body).toBe('hello')
        expect(ct).toContain('text/plain')
    })

    it('rejects when both body and body_raw set', async () => {
        await expect(
            performHttp(
                { method: 'POST', url: 'https://api.test/x', body: { a: 1 }, body_raw: 'abc' },
                {},
            ),
        ).rejects.toThrow(/invalid_input/)
    })
})

describe('performHttp multipart', () => {
    it('sends multipart body', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'magpie-http-'))
        const p = join(dir, 'x.txt')
        writeFileSync(p, 'abc', 'utf8')
        let receivedCt: string | null = null
        let receivedBytes = 0
        server.use(
            http.post('https://api.test/upload', async ({ request }) => {
                receivedCt = request.headers.get('content-type')
                const buf = Buffer.from(await request.arrayBuffer())
                receivedBytes = buf.length
                return HttpResponse.json({ ok: true })
            }),
        )
        await performHttp(
            {
                method: 'POST',
                url: 'https://api.test/upload',
                multipart: { fields: { who: 'alice' }, files: { f: { path: p } } },
            },
            {},
        )
        expect(receivedCt).toContain('multipart/form-data; boundary=')
        expect(receivedBytes).toBeGreaterThan(20)
    })
})

describe('performHttp redirects and limits', () => {
    it('records redirect chain', async () => {
        server.use(
            http.get('https://api.test/r1', () =>
                HttpResponse.redirect('https://api.test/r2', 302),
            ),
            http.get('https://api.test/r2', () =>
                HttpResponse.redirect('https://api.test/r3', 302),
            ),
            http.get('https://api.test/r3', () => HttpResponse.json({ done: true })),
        )
        const r = await performHttp({ method: 'GET', url: 'https://api.test/r1' }, {})
        expect(r.redirectChain).toEqual(['https://api.test/r2', 'https://api.test/r3'])
        expect(r.status).toBe(200)
    })

    it('respects follow_redirects=false', async () => {
        server.use(
            http.get('https://api.test/once', () =>
                HttpResponse.redirect('https://api.test/done', 302),
            ),
        )
        const r = await performHttp(
            { method: 'GET', url: 'https://api.test/once', follow_redirects: false },
            {},
        )
        expect(r.status).toBe(302)
        expect(r.redirectChain).toEqual([])
    })

    it('rejects body_too_large', async () => {
        const key = 'MAGPIE_MAX_RESPONSE_BYTES'
        process.env[key] = '100'
        const { resetConfigCache } = await import('../../src/config.js')
        resetConfigCache()
        server.use(
            http.get(
                'https://api.test/big',
                () =>
                    new Response('x'.repeat(500), {
                        headers: { 'content-type': 'text/plain' },
                    }),
            ),
        )
        await expect(
            performHttp({ method: 'GET', url: 'https://api.test/big' }, {}),
        ).rejects.toThrow(/body_too_large/)
        delete process.env[key]
        resetConfigCache()
    })
})
