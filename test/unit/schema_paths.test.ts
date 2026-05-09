import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderPaths } from '../../src/core/schema/paths.js'

const usersFixture = JSON.parse(readFileSync('test/fixtures/users.json', 'utf8'))

describe('renderPaths', () => {
    it('renders a leaf line per unique path with type and example', () => {
        const out = renderPaths(usersFixture, 1234)
        expect(out).toContain('data[].id')
        expect(out).toContain('int')
        expect(out).toContain('data[].name')
        expect(out).toContain('string')
        expect(out).toContain('(e.g. "alice")')
        expect(out).toContain('data[].roles[]')
    })

    it('unifies nullable types (string|null)', () => {
        const out = renderPaths(usersFixture, 1234)
        expect(out).toMatch(/data\[\]\.profile\.bio\s+:\s+string\|null/)
    })

    it('includes byte-count footer', () => {
        const out = renderPaths(usersFixture, 1234)
        expect(out).toMatch(/# 1\.2 KB/)
    })

    it('includes top-level array size in footer', () => {
        const out = renderPaths(usersFixture, 1234)
        expect(out).toMatch(/data\[\]: 2 items/)
    })

    it('respects depth limit', () => {
        const deep: Record<string, unknown> = {}
        let cur: Record<string, unknown> = deep
        for (let i = 0; i < 15; i++) {
            cur.next = {}
            cur = cur.next as Record<string, unknown>
        }
        cur.value = 1
        const out = renderPaths(deep, 50)
        expect(out).toContain('<max depth>')
    })

    it('truncates long string examples', () => {
        const long = 'x'.repeat(200)
        const out = renderPaths({ s: long }, 200)
        expect(out).toMatch(/string \(e\.g\. .{1,80}\.\.\.\(len=200\)/)
    })
})
