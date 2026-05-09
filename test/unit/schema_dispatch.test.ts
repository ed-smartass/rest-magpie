import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { renderNonJsonDescriptor, renderSchema } from '../../src/core/schema/index.js'

describe('renderSchema dispatcher', () => {
    it('paths returns a string', () => {
        const out = renderSchema('paths', { x: 1 }, 4)
        expect(typeof out).toBe('string')
    })

    it('shape returns a string', () => {
        const out = renderSchema('shape', { x: 1 }, 4)
        expect(typeof out).toBe('string')
    })

    it('sample returns a string', () => {
        const out = renderSchema('sample', { x: 1 }, 4)
        expect(typeof out).toBe('string')
    })

    it('json_schema returns an object', () => {
        const out = renderSchema('json_schema', { x: 1 }, 4)
        expect(typeof out).toBe('object')
    })
})

describe('renderNonJsonDescriptor', () => {
    it('text descriptor', () => {
        const out = renderNonJsonDescriptor('text', '<html>hi</html>', 'text/html; charset=utf-8')
        expect(out).toMatchObject({
            type: 'text',
            content_type: 'text/html; charset=utf-8',
            char_count: 15,
            line_count: 1,
        })
        expect(out.head).toContain('<html>')
    })

    it('binary descriptor', () => {
        const buf = Buffer.from([1, 2, 3, 4, 5])
        const sha = createHash('sha256').update(buf).digest('hex')
        const out = renderNonJsonDescriptor('binary', buf, 'image/png')
        expect(out).toMatchObject({
            type: 'binary',
            content_type: 'image/png',
            byte_count: 5,
            sha256: sha,
        })
    })

    it('empty descriptor', () => {
        const out = renderNonJsonDescriptor('empty', null, undefined)
        expect(out).toEqual({ type: 'empty' })
    })
})
