import type { Config } from '../../config.js'

// `body_mode: "head"` builds a *preview* of the body alongside the schema.
// The preview keeps the structural shape but truncates the heaviest leaves
// (long arrays, long strings) so the agent gets a realistic feel for the
// data without the full byte cost. Each truncation site carries a sibling
// `_truncated` marker so the agent knows what was dropped.

export interface ArrayTruncationMarker {
    kind: 'array'
    original_length: number
    included: number
}

export interface StringTruncationMarker {
    kind: 'string'
    original_length: number
    included: number
}

interface PreviewLimits {
    items: number
    stringChars: number
}

const limits = (
    cfg: Pick<Config, 'headPreviewItems' | 'headPreviewStringChars'>,
): PreviewLimits => ({
    items: cfg.headPreviewItems,
    stringChars: cfg.headPreviewStringChars,
})

export const renderJsonPreview = (
    value: unknown,
    cfg: Pick<Config, 'headPreviewItems' | 'headPreviewStringChars'>,
): unknown => {
    return walk(value, limits(cfg))
}

const walk = (value: unknown, lim: PreviewLimits): unknown => {
    if (value === null) return null
    if (typeof value === 'string') {
        if (value.length <= lim.stringChars) return value
        return {
            _truncated: {
                kind: 'string',
                original_length: value.length,
                included: lim.stringChars,
            } satisfies StringTruncationMarker,
            head: value.slice(0, lim.stringChars),
        }
    }
    if (typeof value !== 'object') return value // numbers, booleans
    if (Array.isArray(value)) {
        if (value.length <= lim.items) return value.map((v) => walk(v, lim))
        const head = value.slice(0, lim.items).map((v) => walk(v, lim))
        return [
            ...head,
            {
                _truncated: {
                    kind: 'array',
                    original_length: value.length,
                    included: lim.items,
                } satisfies ArrayTruncationMarker,
            },
        ]
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = walk(v, lim)
    }
    return out
}

export const renderTextPreview = (
    body: string,
    cfg: Pick<Config, 'headPreviewStringChars'>,
): unknown => {
    if (body.length <= cfg.headPreviewStringChars) return body
    return {
        _truncated: {
            kind: 'string',
            original_length: body.length,
            included: cfg.headPreviewStringChars,
        } satisfies StringTruncationMarker,
        head: body.slice(0, cfg.headPreviewStringChars),
    }
}
