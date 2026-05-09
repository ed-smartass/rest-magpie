import type { BodyKind } from '../types.js'

const TEXT_PREFIXES = ['text/']
const TEXT_EXACT = new Set([
    'application/xml',
    'application/yaml',
    'application/x-yaml',
    'application/javascript',
    'application/x-www-form-urlencoded',
])

export const classifyContentType = (ct: string | undefined): BodyKind => {
    if (!ct) return 'binary'
    const main = ct.split(';', 1)[0]?.trim().toLowerCase() ?? ''
    if (!main) return 'binary'
    if (main === 'application/json' || main.endsWith('+json')) return 'json'
    for (const p of TEXT_PREFIXES) if (main.startsWith(p)) return 'text'
    if (TEXT_EXACT.has(main)) return 'text'
    return 'binary'
}

export const parseCharset = (ct: string | undefined): string | undefined => {
    if (!ct) return undefined
    const parts = ct.split(';').slice(1)
    for (const p of parts) {
        const [k, v] = p.split('=').map((s) => s.trim())
        if (k?.toLowerCase() === 'charset' && v) {
            return v.toLowerCase().replace(/^"|"$/g, '')
        }
    }
    return undefined
}
