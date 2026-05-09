import { getConfig } from '../../config.js'

interface PathInfo {
    types: Set<string>
    example?: string
}

export const renderPaths = (value: unknown, bodyBytes: number): string => {
    const cfg = getConfig()
    const paths = new Map<string, PathInfo>()
    walk(value, '', paths, 0, cfg.schemaMaxDepth)

    const ordered = [...paths.entries()]
    const longest = ordered.reduce((m, [k]) => Math.max(m, k.length), 0)

    const lines: string[] = []
    for (const [path, info] of ordered) {
        const types = formatTypes(info.types)
        const example = info.example ? ' (e.g. ' + info.example + ')' : ''
        lines.push(path.padEnd(longest) + ' : ' + types + example)
    }

    const footer = renderFooter(value, bodyBytes)
    return lines.length ? lines.join('\n') + '\n\n' + footer : footer
}

const walk = (
    value: unknown,
    path: string,
    out: Map<string, PathInfo>,
    depth: number,
    max: number,
): void => {
    if (depth > max) {
        addLeaf(out, path + '.???', '<max depth>')
        return
    }
    if (value === null) {
        addLeaf(out, path || '(root)', 'null')
        return
    }
    if (typeof value === 'string') {
        addLeaf(out, path || '(root)', 'string', JSON.stringify(truncateForExample(value)))
        return
    }
    if (typeof value === 'number') {
        addLeaf(
            out,
            path || '(root)',
            Number.isInteger(value) ? 'int' : 'float',
            JSON.stringify(value),
        )
        return
    }
    if (typeof value === 'boolean') {
        addLeaf(out, path || '(root)', 'bool', JSON.stringify(value))
        return
    }
    if (Array.isArray(value)) {
        if (value.length === 0) {
            addLeaf(out, path + '[]', '<empty>')
            return
        }
        for (const item of value) walk(item, path + '[]', out, depth + 1, max)
        return
    }
    if (typeof value === 'object') {
        const cfg = getConfig()
        const keys = Object.keys(value)
        const limit = cfg.schemaMaxObjectKeys
        const visible = keys.slice(0, limit)
        for (const k of visible) {
            walk(
                (value as Record<string, unknown>)[k],
                path ? path + '.' + k : k,
                out,
                depth + 1,
                max,
            )
        }
        if (keys.length > limit) {
            addLeaf(out, path + '.<...>', keys.length - limit + ' more keys')
        }
    }
}

const addLeaf = (
    out: Map<string, PathInfo>,
    path: string,
    type: string,
    example?: string,
): void => {
    let info = out.get(path)
    if (!info) {
        info = { types: new Set(), example }
        out.set(path, info)
    } else if (info.example === undefined && example !== undefined) {
        info.example = example
    }
    info.types.add(type)
}

const formatTypes = (types: Set<string>): string => {
    const list = [...types]
    // Move "null" to the end so unions read as "string|null".
    list.sort((a, b) => (a === 'null' ? 1 : b === 'null' ? -1 : a.localeCompare(b)))
    return list.join('|')
}

const truncateForExample = (s: string): string => {
    const limit = 60
    if (s.length <= limit) return s
    return s.slice(0, limit) + '...(len=' + s.length + ')'
}

const renderFooter = (value: unknown, bodyBytes: number): string => {
    const parts: string[] = ['# ' + humanBytes(bodyBytes)]
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (Array.isArray(v)) parts.push(k + '[]: ' + v.length + ' items')
        }
    } else if (Array.isArray(value)) {
        parts.push('(root)[]: ' + value.length + ' items')
    }
    return parts.join(' · ')
}

const humanBytes = (n: number): string => {
    if (n < 1024) return n + ' B'
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
    return (n / 1024 / 1024).toFixed(1) + ' MB'
}
