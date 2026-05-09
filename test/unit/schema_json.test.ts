import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderJsonSchema } from '../../src/core/schema/json_schema.js'

const usersFixture = JSON.parse(readFileSync('test/fixtures/users.json', 'utf8'))

describe('renderJsonSchema', () => {
    it('returns an object with $schema-style top-level type', () => {
        const out = renderJsonSchema(usersFixture)
        expect(typeof out).toBe('object')
        expect((out as Record<string, unknown>).type).toBe('object')
        expect((out as Record<string, unknown>).properties).toMatchObject({
            data: expect.any(Object),
        })
    })

    it('strips required arrays', () => {
        const out = renderJsonSchema(usersFixture)
        const json = JSON.stringify(out)
        expect(json).not.toContain('"required"')
    })
})
