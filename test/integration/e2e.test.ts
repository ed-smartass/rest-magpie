import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Cache } from '../../src/core/cache.js'
import { isError } from '../../src/core/errors.js'
import { httpInspectTool } from '../../src/tools/http_inspect.js'
import { httpReadTool } from '../../src/tools/http_read.js'
import { httpRequestTool } from '../../src/tools/http_request.js'

const server = setupServer()
beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('e2e', () => {
    it('request → read with mask → inspect', async () => {
        const payload = {
            data: [
                { id: 1, name: 'alice' },
                { id: 2, name: 'bob' },
            ],
            meta: { total: 2 },
        }
        server.use(http.get('https://api.test/u', () => HttpResponse.json(payload)))

        const cache = new Cache(60)
        const r1 = await httpRequestTool(
            {
                method: 'GET',
                url: 'https://api.test/u',
                schema_format: 'paths',
                include_body: false,
            },
            cache,
        )
        if (isError(r1)) throw new Error()
        expect(r1.body).toBeUndefined()
        expect(r1.schema).toContain('data[].id')

        const r2 = await httpReadTool({ cache_id: r1.cache_id, mask: '.data | map(.name)' }, cache)
        if (isError(r2)) throw new Error()
        expect(r2.result).toEqual(['alice', 'bob'])

        const r3 = await httpInspectTool({ cache_id: r1.cache_id, schema_format: 'shape' }, cache)
        if (isError(r3)) throw new Error()
        expect(typeof r3.schema).toBe('string')
    })
})
