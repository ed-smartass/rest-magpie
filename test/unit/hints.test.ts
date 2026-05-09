import { describe, expect, it } from 'vitest'
import { inferNextStepHints } from '../../src/core/schema/hints.js'

describe('inferNextStepHints', () => {
    it('returns array hints for an array of objects', () => {
        const hints = inferNextStepHints([
            { id: 1, name: 'a' },
            { id: 2, name: 'b' },
        ])
        expect(hints[0]).toBe('length')
        expect(hints).toContain('.[:5]')
        expect(hints.some((h) => h.includes('map'))).toBe(true)
    })

    it('returns scalar-array hints for an array of numbers', () => {
        const hints = inferNextStepHints([1, 2, 3, 4])
        expect(hints).toContain('length')
        expect(hints).toContain('. | unique')
        expect(hints).toContain('. | min')
    })

    it('targets array-valued fields for objects with arrays', () => {
        const hints = inferNextStepHints({ data: [{ id: 1 }], meta: { total: 5 } })
        expect(hints.some((h) => h.startsWith('.data'))).toBe(true)
    })

    it('returns key-listing hints for a plain object', () => {
        const hints = inferNextStepHints({ a: 1, b: 2 })
        expect(hints).toContain('keys')
    })

    it('returns empty for null and primitives', () => {
        expect(inferNextStepHints(null)).toEqual([])
        expect(inferNextStepHints(42)).toEqual([])
        expect(inferNextStepHints('s')).toEqual([])
    })

    it('returns just length for an empty array', () => {
        expect(inferNextStepHints([])).toEqual(['length'])
    })
})
