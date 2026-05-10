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

    it('skips identifier-unsafe keys in projection shorthand for object arrays', () => {
        // Keys with hyphens and digits would emit syntactically invalid jq
        // when interpolated raw into `map({...})`. Only safe keys land.
        const hints = inferNextStepHints([{ 'user-id': 1, '2fa_enabled': true, name: 'a' }])
        expect(hints.some((h) => h.includes('user-id'))).toBe(false)
        expect(hints.some((h) => h.includes('2fa_enabled'))).toBe(false)
        // 'name' is identifier-safe and should appear; if it's the only safe
        // key the single-key form is used.
        expect(hints.some((h) => h.includes('{name}') || h.includes('name'))).toBe(true)
    })

    it('emits bracket-quoted form for non-identifier array-field keys', () => {
        // The array-field is targeted with `."weird-key"` instead of crashing.
        const hints = inferNextStepHints({ 'weird-key': [{ id: 1 }] })
        expect(hints.some((h) => h.startsWith('."weird-key"'))).toBe(true)
        // No raw `.weird-key` (which jq would parse as subtraction).
        expect(hints.every((h) => !/^\.weird-key\b/.test(h))).toBe(true)
    })

    it('skips object projection when no identifier-safe keys exist', () => {
        const hints = inferNextStepHints({ 'a-b': 1, '2x': 2 })
        // `keys` and `to_entries` are always-safe; no `{a-b}` style hint.
        expect(hints).toContain('keys')
        expect(hints.every((h) => !h.includes('a-b') && !h.includes('2x'))).toBe(true)
    })

    it('does NOT emit map({id, name}) for scalar-valued array fields', () => {
        // For { data: [1,2,3] } the projection is nonsense — would crash jq.
        // Should suggest `unique` instead.
        const hints = inferNextStepHints({ data: [1, 2, 3] })
        expect(hints).toContain('.data | length')
        expect(hints).toContain('.data | unique')
        expect(hints.every((h) => !h.includes('map({'))).toBe(true)
    })

    it('emits map({safe_keys}) for object-valued array fields with mixed-safety keys', () => {
        const hints = inferNextStepHints({ data: [{ id: 1, 'weird-key': 2, name: 'a' }] })
        // Only id + name go into the projection shorthand; weird-key skipped.
        expect(hints.some((h) => h.includes('map({id, name})'))).toBe(true)
        expect(hints.every((h) => !h.includes('weird-key'))).toBe(true)
    })
})
