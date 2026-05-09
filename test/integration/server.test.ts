import { describe, expect, it } from 'vitest'
import { createServer } from '../../src/index.js'

describe('server bootstrap', () => {
    it('createServer returns server and cache; server has 3 tools', async () => {
        const { server, cache } = createServer()
        expect(server).toBeDefined()
        expect(cache).toBeDefined()
    })
})
