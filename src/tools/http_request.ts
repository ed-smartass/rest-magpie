import { getConfig } from '../config.js'
import type { Cache } from '../core/cache.js'
import { makeError } from '../core/errors.js'
import { type HttpRunResult, performHttp } from '../core/http.js'
import { renderNonJsonDescriptor, renderSchema } from '../core/schema/index.js'
import type {
    BodyKind,
    CacheEntry,
    HttpRequestParams,
    HttpRequestResult,
    IncludeBody,
    NonJsonSchemaDescriptor,
    ResponseMeta,
    Result,
    Schema,
} from '../types.js'

export const httpRequestTool = async (
    params: HttpRequestParams,
    cache: Cache,
): Promise<Result<HttpRequestResult>> => {
    if (params.download_to && params.include_body === true) {
        return makeError(
            'invalid_input',
            'download_to is mutually exclusive with include_body=true',
        )
    }

    let runResult: HttpRunResult
    try {
        runResult = await performHttp(params, {})
    } catch (e) {
        return classifyHttpError(e)
    }

    const include = decideIncludeBody(
        params.include_body ?? 'auto',
        runResult.body_kind,
        runResult.bodyBytes,
    )
    const cache_id = cache.newId()
    const schemaFormat = params.schema_format ?? 'paths'

    let schema: Schema
    if (runResult.body_kind === 'json') {
        schema = renderSchema(schemaFormat, runResult.parsedBody, runResult.bodyBytes)
    } else if (runResult.downloadPath) {
        // Binary streamed straight to disk; compose the descriptor from runResult metadata.
        const descriptor: NonJsonSchemaDescriptor = {
            type: 'binary',
            content_type: runResult.contentType,
            byte_count: runResult.bodyBytes,
            sha256: runResult.sha256,
        }
        schema = descriptor
    } else {
        schema = renderNonJsonDescriptor(
            runResult.body_kind,
            runResult.parsedBody as string | Buffer | null,
            runResult.contentType,
        )
    }

    const meta: ResponseMeta = {
        url: runResult.finalUrl,
        method: params.method,
        duration_ms: runResult.durationMs,
        response_headers: runResult.headers,
        body_bytes: runResult.bodyBytes,
        content_type: runResult.contentType,
        body_kind: runResult.body_kind,
        body_included: include,
        redirect_chain: runResult.redirectChain,
        download_path: runResult.downloadPath,
    }

    const entry: CacheEntry = {
        cache_id,
        created_at: Date.now(),
        body_kind: runResult.body_kind,
        body: runResult.parsedBody,
        status: runResult.status,
        meta,
    }
    cache.put(entry)

    const result: HttpRequestResult = {
        cache_id,
        status: runResult.status,
        meta,
        schema,
        ...(include ? { body: runResult.parsedBody } : {}),
    }
    return result
}

const decideIncludeBody = (mode: IncludeBody, kind: BodyKind, bytes: number): boolean => {
    if (kind === 'binary') return false
    if (mode === true) return true
    if (mode === false) return false
    return bytes <= getConfig().autoIncludeBodyBytes
}

const classifyHttpError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    const kind = (e as { kind?: string }).kind
    if (kind === 'invalid_url') return makeError('invalid_url', msg)
    if (kind === 'invalid_input') return makeError('invalid_input', msg)
    if (kind === 'body_too_large') return makeError('body_too_large', msg)
    if (kind === 'redirect_loop') return makeError('redirect_loop', msg)
    if (
        msg.includes('UND_ERR_HEADERS_TIMEOUT') ||
        msg.includes('aborted') ||
        /timeout/i.test(msg)
    ) {
        return makeError('timeout', msg)
    }
    if (/certificate|TLS|self.signed/i.test(msg)) return makeError('tls_error', msg)
    return makeError('network_error', msg)
}
