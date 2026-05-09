import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderShape } from '../../src/core/schema/shape.js'

const usersFixture = JSON.parse(readFileSync('test/fixtures/users.json', 'utf8'))

describe('renderShape', () => {
    it('renders nested object/array shape', () => {
        const out = renderShape(usersFixture, 1234)
        expect(out).toMatch(/\{[\s\S]*data: \[\{[\s\S]*\}\] \(2 items\)/)
        expect(out).toMatch(/id: int/)
        expect(out).toMatch(/name: string/)
        expect(out).toMatch(/roles: string\[\]/)
        expect(out).toMatch(/profile: \{ bio: string\|null \}/)
        expect(out).toMatch(/meta: \{ total: int, next_cursor: string \}/)
        expect(out).toContain('# 1.2 KB')
    })

    it('represents heterogeneous arrays as union types', () => {
        const out = renderShape({ mixed: [1, 'two'] }, 100)
        expect(out).toMatch(/mixed: \(int\|string\)\[\]/)
    })
})
