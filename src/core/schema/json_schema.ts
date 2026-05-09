import { createSchema } from 'genson-js'
import type { JsonSchemaObject } from '../../types.js'

export const renderJsonSchema = (value: unknown): JsonSchemaObject => {
    const inferred = createSchema(value as never) as JsonSchemaObject
    return stripRequired(inferred) as JsonSchemaObject
}

const stripRequired = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(stripRequired)
    if (node && typeof node === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(node)) {
            if (k === 'required') continue
            out[k] = stripRequired(v)
        }
        return out
    }
    return node
}
