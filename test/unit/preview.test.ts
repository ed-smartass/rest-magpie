import { describe, expect, it } from 'vitest'
import type { Config } from '../../src/config.js'
import { renderJsonPreview, renderTextPreview } from '../../src/core/schema/preview.js'

const cfg = (overrides: Partial<Config> = {}): Config =>
    ({
        headPreviewItems: 3,
        headPreviewStringChars: 20,
        ...overrides,
    }) as Config

describe('renderJsonPreview', () => {
    it('passes through small arrays unchanged', () => {
        expect(renderJsonPreview([1, 2, 3], cfg())).toEqual([1, 2, 3])
    })

    it('truncates long arrays with a sibling _truncated marker', () => {
        const arr = [1, 2, 3, 4, 5, 6, 7]
        const out = renderJsonPreview(arr, cfg()) as unknown[]
        expect(out.slice(0, 3)).toEqual([1, 2, 3])
        const marker = out[3] as {
            _truncated: { kind: string; original_length: number; included: number }
        }
        expect(marker._truncated).toEqual({ kind: 'array', original_length: 7, included: 3 })
    })

    it('truncates long strings inside objects', () => {
        const out = renderJsonPreview(
            { name: 'short', text: 'x'.repeat(100) },
            cfg({ headPreviewStringChars: 10 }),
        ) as Record<string, unknown>
        expect(out.name).toBe('short')
        const marker = out.text as { _truncated: { original_length: number }; head: string }
        expect(marker._truncated.original_length).toBe(100)
        expect(marker.head).toBe('xxxxxxxxxx')
    })

    it('handles nested arrays of objects', () => {
        const data = { items: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }] }
        const out = renderJsonPreview(data, cfg()) as Record<string, unknown>
        const items = out.items as unknown[]
        expect(items).toHaveLength(4) // 3 items + 1 marker
        expect(
            (items[3] as { _truncated: { original_length: number } })._truncated.original_length,
        ).toBe(5)
    })

    it('passes scalars and null through', () => {
        expect(renderJsonPreview(null, cfg())).toBeNull()
        expect(renderJsonPreview(42, cfg())).toBe(42)
        expect(renderJsonPreview(true, cfg())).toBe(true)
    })
})

describe('renderTextPreview', () => {
    it('returns short text unchanged', () => {
        expect(renderTextPreview('hello', cfg({ headPreviewStringChars: 100 }))).toBe('hello')
    })

    it('truncates long text with marker', () => {
        const out = renderTextPreview('x'.repeat(50), cfg({ headPreviewStringChars: 10 }))
        const marker = out as { _truncated: { original_length: number }; head: string }
        expect(marker._truncated.original_length).toBe(50)
        expect(marker.head).toBe('xxxxxxxxxx')
    })
})
