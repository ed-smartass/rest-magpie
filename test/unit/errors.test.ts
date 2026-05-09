import { describe, expect, it } from 'vitest'
import { isError, makeError } from '../../src/core/errors.js'

describe('errors', () => {
    it('makeError builds an envelope with kind and message', () => {
        const e = makeError('invalid_input', 'missing url')
        expect(e).toEqual({ error: { kind: 'invalid_input', message: 'missing url' } })
    })

    it('makeError accepts optional detail', () => {
        const e = makeError('network_error', 'ECONNREFUSED', { code: 'ECONNREFUSED' })
        expect(e.error.detail).toEqual({ code: 'ECONNREFUSED' })
    })

    it('isError narrows correctly on envelopes', () => {
        expect(isError({ error: { kind: 'cache_miss', message: 'x' } })).toBe(true)
        expect(isError({ result: 42 } as unknown)).toBe(false)
        expect(isError(null)).toBe(false)
    })
})
