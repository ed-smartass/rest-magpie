import { getConfig } from '../../config.js'

export const renderShape = (value: unknown, bodyBytes: number): string => {
    const body = renderNode(value, 0, getConfig().schemaMaxDepth)
    return body + '\n# ' + humanBytes(bodyBytes)
}

const renderNode = (value: unknown, depth: number, max: number): string => {
    if (depth > max) return '<max depth>'
    if (value === null) return 'null'
    switch (typeof value) {
        case 'string':
            return 'string'
        case 'number':
            return Number.isInteger(value) ? 'int' : 'float'
        case 'boolean':
            return 'bool'
    }
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]'
        const allObjects = value.every(
            (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
        )
        if (allObjects) {
            const merged = mergeObjects(value as Record<string, unknown>[], depth + 1, max)
            return '[' + merged + '] (' + value.length + ' items)'
        }
        const itemTypes = new Set(value.map((v) => renderNode(v, depth + 1, max)))
        if (itemTypes.size === 1) {
            return [...itemTypes][0] + '[] (' + value.length + ' items)'
        }
        return '(' + unifyTypes(itemTypes) + ')[] (' + value.length + ' items)'
    }
    if (typeof value === 'object') {
        return renderObject(value as Record<string, unknown>, depth, max)
    }
    return 'unknown'
}

const renderObject = (obj: Record<string, unknown>, depth: number, max: number): string => {
    const cfg = getConfig()
    const keys = Object.keys(obj).sort()
    const limit = cfg.schemaMaxObjectKeys
    const visible = keys.slice(0, limit)
    const fields = visible.map((k) => k + ': ' + renderNode(obj[k], depth + 1, max)).join(', ')
    const overflow = keys.length > limit ? ', # ' + (keys.length - limit) + ' more keys' : ''
    return '{ ' + fields + overflow + ' }'
}

const mergeObjects = (items: Record<string, unknown>[], depth: number, max: number): string => {
    if (depth > max) return '<max depth>'
    const allKeys: string[] = []
    const seen = new Set<string>()
    for (const item of items) {
        for (const k of Object.keys(item)) {
            if (!seen.has(k)) {
                seen.add(k)
                allKeys.push(k)
            }
        }
    }
    const cfg = getConfig()
    const limit = cfg.schemaMaxObjectKeys
    allKeys.sort()
    const visible = allKeys.slice(0, limit)
    const fields: string[] = []
    for (const k of visible) {
        const values = items.map((item) => item[k]).filter((v) => v !== undefined)
        const allObjs = values.every(
            (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
        )
        let rendered: string
        if (allObjs && values.length > 0) {
            rendered = mergeObjects(values as Record<string, unknown>[], depth + 1, max)
        } else {
            const types = new Set(values.map((v) => renderNode(v, depth + 1, max)))
            rendered = unifyTypes(types)
        }
        fields.push(k + ': ' + rendered)
    }
    const overflow = allKeys.length > limit ? ', # ' + (allKeys.length - limit) + ' more keys' : ''
    return '{ ' + fields.join(', ') + overflow + ' }'
}

const unifyTypes = (types: Set<string>): string => {
    const list = [...types]
    list.sort((a, b) => (a === 'null' ? 1 : b === 'null' ? -1 : a.localeCompare(b)))
    return list.join('|')
}

const humanBytes = (n: number): string => {
    if (n < 1024) return n + ' B'
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
    return (n / 1024 / 1024).toFixed(1) + ' MB'
}
