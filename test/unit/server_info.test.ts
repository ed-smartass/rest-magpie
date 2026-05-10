import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetConfigCache } from '../../src/config.js'
import { serverInfoTool } from '../../src/tools/server_info.js'

describe('serverInfoTool', () => {
    beforeEach(() => {
        for (const k of Object.keys(process.env).filter((k) => k.startsWith('PEEK_'))) {
            Reflect.deleteProperty(process.env, k)
        }
        resetConfigCache()
    })
    afterEach(() => resetConfigCache())

    it('returns version, runtime, cwd, files_root, effective_limits', () => {
        const r = serverInfoTool('1.2.3')
        expect(r.version).toBe('1.2.3')
        expect(['npx', 'docker', 'unknown']).toContain(r.runtime)
        expect(r.cwd).toBe(process.cwd())
        expect(r.files_root).toBeNull()
        expect(r.effective_limits.inline_threshold_bytes).toBe(8192)
        expect(r.effective_limits.head_preview_items).toBe(5)
        expect(r.effective_limits.inline_body_cap_bytes).toBe(256 * 1024)
    })

    it('reflects PEEK_FILES_ROOT when set', () => {
        process.env.PEEK_FILES_ROOT = '/tmp/data'
        resetConfigCache()
        const r = serverInfoTool('1.0.0')
        expect(r.files_root).toBe('/tmp/data')
    })

    it('reflects custom env-var values in effective_limits', () => {
        process.env.PEEK_INLINE_THRESHOLD_BYTES = '1024'
        process.env.PEEK_INLINE_BODY_CAP = '4096'
        process.env.PEEK_HEAD_PREVIEW_ITEMS = '10'
        resetConfigCache()
        const r = serverInfoTool('1.0.0')
        expect(r.effective_limits.inline_threshold_bytes).toBe(1024)
        expect(r.effective_limits.inline_body_cap_bytes).toBe(4096)
        expect(r.effective_limits.head_preview_items).toBe(10)
    })
})
