import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/config.js'

describe('config', () => {
    const original = { ...process.env }
    beforeEach(() => {
        for (const k of Object.keys(process.env).filter((k) => k.startsWith('MAGPIE_'))) {
            delete process.env[k]
        }
    })
    afterEach(() => {
        process.env = { ...original }
    })

    it('returns defaults when no env vars are set', () => {
        const c = loadConfig()
        expect(c.defaultTimeoutMs).toBe(30000)
        expect(c.maxResponseBytes).toBe(50 * 1024 * 1024)
        expect(c.cacheTtlSeconds).toBe(600)
        expect(c.autoIncludeBodyBytes).toBe(8192)
        expect(c.jqTimeoutMs).toBe(5000)
        expect(c.useNativeJq).toBe(false)
        expect(c.tlsInsecure).toBe(false)
        expect(c.schemaMaxDepth).toBe(10)
        expect(c.schemaMaxObjectKeys).toBe(200)
        expect(c.schemaSampleMaxString).toBe(100)
        expect(c.filesRoot).toBeUndefined()
    })

    it('captures MAGPIE_FILES_ROOT as an absolute resolved path', () => {
        process.env.MAGPIE_FILES_ROOT = '/data/uploads/'
        expect(loadConfig().filesRoot).toBe('/data/uploads')
    })

    it('treats empty MAGPIE_FILES_ROOT as unset', () => {
        process.env.MAGPIE_FILES_ROOT = ''
        expect(loadConfig().filesRoot).toBeUndefined()
    })

    it('respects integer env vars', () => {
        process.env.MAGPIE_DEFAULT_TIMEOUT_MS = '5000'
        process.env.MAGPIE_AUTO_INCLUDE_BODY_BYTES = '1024'
        const c = loadConfig()
        expect(c.defaultTimeoutMs).toBe(5000)
        expect(c.autoIncludeBodyBytes).toBe(1024)
    })

    it('respects boolean env vars (1/true/yes/on)', () => {
        for (const v of ['1', 'true', 'yes', 'on']) {
            process.env.MAGPIE_TLS_INSECURE = v
            expect(loadConfig().tlsInsecure).toBe(true)
        }
        process.env.MAGPIE_TLS_INSECURE = '0'
        expect(loadConfig().tlsInsecure).toBe(false)
    })

    it('falls back to default for malformed integer', () => {
        process.env.MAGPIE_DEFAULT_TIMEOUT_MS = 'not-a-number'
        expect(loadConfig().defaultTimeoutMs).toBe(30000)
    })
})
