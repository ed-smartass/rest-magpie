import { createHash } from 'node:crypto'
import type { BodyKind, NonJsonSchemaDescriptor, Schema, SchemaFormat } from '../../types.js'
import { renderJsonSchema } from './json_schema.js'
import { renderPaths } from './paths.js'
import { renderSample } from './sample.js'
import { renderShape } from './shape.js'

export const renderSchema = (format: SchemaFormat, parsed: unknown, bodyBytes: number): Schema => {
    switch (format) {
        case 'paths':
            return renderPaths(parsed, bodyBytes)
        case 'shape':
            return renderShape(parsed, bodyBytes)
        case 'sample':
            return renderSample(parsed, bodyBytes)
        case 'json_schema':
            return renderJsonSchema(parsed)
    }
}

export const renderNonJsonDescriptor = (
    kind: Exclude<BodyKind, 'json'>,
    body: string | Buffer | null,
    contentType: string | undefined,
): NonJsonSchemaDescriptor => {
    if (kind === 'empty') return { type: 'empty' }
    if (kind === 'text' && typeof body === 'string') {
        const lines = body.split('\n').length
        return {
            type: 'text',
            content_type: contentType,
            char_count: body.length,
            line_count: lines,
            head: body.slice(0, 300),
        }
    }
    if (kind === 'binary' && Buffer.isBuffer(body)) {
        return {
            type: 'binary',
            content_type: contentType,
            byte_count: body.length,
            sha256: createHash('sha256').update(body).digest('hex'),
        }
    }
    // Defensive fallback.
    return { type: kind }
}
