import type { Cache } from '../core/cache.js'
import { makeError } from '../core/errors.js'
import { inferNextStepHints } from '../core/schema/hints.js'
import { renderNonJsonDescriptor, renderSchema } from '../core/schema/index.js'
import type { HttpInspectParams, HttpInspectResult, Result } from '../types.js'

export const httpInspectTool = async (
    params: HttpInspectParams,
    cache: Cache,
): Promise<Result<HttpInspectResult>> => {
    const entry = cache.get(params.cache_id)
    if (!entry) return makeError('cache_miss', 'unknown cache_id: ' + params.cache_id)

    if (entry.body_kind === 'json') {
        const result: HttpInspectResult = {
            schema: renderSchema(params.schema_format, entry.body, entry.meta.body_bytes),
        }
        const hints = inferNextStepHints(entry.body)
        if (hints.length > 0) result.next_step_hints = hints
        return result
    }
    return {
        schema: renderNonJsonDescriptor(
            entry.body_kind,
            entry.body as string | Buffer | null,
            entry.meta.content_type,
        ),
    }
}
