import { getConfig } from '../../config.js'

const BASE64_RE = /^[A-Za-z0-9+/=]{200,}$/

export const renderSample = (value: unknown, _bodyBytes: number): string => {
    return JSON.stringify(reduce(value, 0, getConfig().schemaMaxDepth), null, 2)
}

const reduce = (value: unknown, depth: number, max: number): unknown => {
    if (depth > max) return '<max depth>'
    if (value === null || typeof value !== 'object') {
        if (typeof value === 'string') return truncateString(value)
        return value
    }
    if (Array.isArray(value)) {
        if (value.length <= 1) return value.map((v) => reduce(v, depth + 1, max))
        return [reduce(value[0], depth + 1, max), '...' + (value.length - 1) + ' more']
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = reduce(v, depth + 1, max)
    return out
}

const truncateString = (s: string): string => {
    const cfg = getConfig()
    const sampleLimit = cfg.schemaSampleMaxString
    if (BASE64_RE.test(s)) {
        return s.slice(0, 50) + '...(len=' + s.length + ')'
    }
    if (s.length > sampleLimit) {
        return s.slice(0, sampleLimit) + '...(len=' + s.length + ')'
    }
    return s
}
