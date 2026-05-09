import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderSample } from '../../src/core/schema/sample.js'

const usersFixture = JSON.parse(readFileSync('test/fixtures/users.json', 'utf8'))

describe('renderSample', () => {
    it('collapses arrays to first element + sentinel', () => {
        const out = JSON.parse(renderSample(usersFixture, 1234))
        expect(out.data).toHaveLength(2)
        expect(out.data[0]).toMatchObject({ id: 42, name: 'alice' })
        expect(out.data[1]).toBe('...1 more')
    })

    it('keeps single-element arrays intact', () => {
        const out = JSON.parse(renderSample({ x: [1] }, 100))
        expect(out.x).toEqual([1])
    })

    it('truncates strings over 100 chars', () => {
        const long = 'x'.repeat(150)
        const out = JSON.parse(renderSample({ s: long }, 200))
        expect(out.s).toMatch(/x{1,100}\.\.\.\(len=150\)/)
    })

    it('aggressively truncates base64-looking strings', () => {
        const b64 = 'A'.repeat(300)
        const out = JSON.parse(renderSample({ data: b64 }, 400))
        expect(out.data).toMatch(/A{1,50}\.\.\.\(len=300\)/)
    })
})
