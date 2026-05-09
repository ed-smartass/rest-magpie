import { describe, expect, it } from 'vitest'
import { runJq } from '../../src/core/jq.js'

describe('runJq', () => {
    it('returns scalar for single-output (output_mode=all)', async () => {
        const r = await runJq({ a: 1, b: 2 }, '.a', 'all')
        expect(r).toEqual({ ok: true, value: 1 })
    })

    it('collects multi-output as array (output_mode=all)', async () => {
        const r = await runJq({ data: [1, 2, 3] }, '.data[]', 'all')
        expect(r).toEqual({ ok: true, value: [1, 2, 3] })
    })

    it('returns first only (output_mode=first)', async () => {
        const r = await runJq({ data: [1, 2, 3] }, '.data[]', 'first')
        expect(r).toEqual({ ok: true, value: 1 })
    })

    it('reports syntax error', async () => {
        const r = await runJq({}, '....bogus', 'all')
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.kind).toBe('jq_syntax_error')
    })

    it('reports runtime error', async () => {
        const r = await runJq([1, 2], '.name', 'all')
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.kind).toBe('jq_runtime_error')
    })

    it('returns null (not undefined) when output_mode=first has no output', async () => {
        // .data[] on an empty array yields zero outputs. With `undefined` the
        // value would disappear during JSON.stringify on the way back to the
        // agent, leaving a misleadingly-empty response.
        const r = await runJq({ data: [] }, '.data[]', 'first')
        expect(r).toEqual({ ok: true, value: null })
    })

    it('returns null when output_mode=first matches no key (empty)', async () => {
        const r = await runJq({ a: 1 }, '.b // empty', 'first')
        expect(r).toEqual({ ok: true, value: null })
    })
})
