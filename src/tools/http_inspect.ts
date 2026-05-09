import type { Cache } from '../core/cache.js'
import { makeError } from '../core/errors.js'
import { renderNonJsonDescriptor, renderSchema } from '../core/schema/index.js'
import type { HttpInspectParams, HttpInspectResult, Result } from '../types.js'

export const httpInspectTool = async (
    params: HttpInspectParams,
    cache: Cache,
): Promise<Result<HttpInspectResult>> => {
    const entry = cache.get(params.cache_id)
    if (!entry) return makeError('cache_miss', 'unknown cache_id: ' + params.cache_id)

    if (entry.body_kind === 'json') {
        return {
            schema: renderSchema(params.schema_format, entry.body, entry.meta.body_bytes),
        }
    }
    return {
        schema: renderNonJsonDescriptor(
            entry.body_kind,
            entry.body as string | Buffer | null,
            entry.meta.content_type,
        ),
    }
}
