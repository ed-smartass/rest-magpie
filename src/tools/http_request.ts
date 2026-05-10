import { getConfig } from '../config.js'
import type { Cache } from '../core/cache.js'
import { makeError } from '../core/errors.js'
import { type HttpRunResult, performHttp } from '../core/http.js'
import { ensureUnderRoot } from '../core/paths.js'
import { inferNextStepHints } from '../core/schema/hints.js'
import { renderNonJsonDescriptor, renderSchema } from '../core/schema/index.js'
import { renderJsonPreview, renderTextPreview } from '../core/schema/preview.js'
import type {
    BodyInclusion,
    BodyKind,
    BodyMode,
    CacheEntry,
    HttpRequestParams,
    HttpRequestResult,
    NonJsonSchemaDescriptor,
    ResolvedBodyMode,
    ResponseMeta,
    Result,
    Schema,
} from '../types.js'

export const httpRequestTool = async (
    params: HttpRequestParams,
    cache: Cache,
): Promise<Result<HttpRequestResult>> => {
    // Loud rejection of the legacy v0.1.x parameter so agents and humans
    // see the migration path immediately rather than silently getting the
    // default behaviour.
    if (Object.hasOwn(params as object, 'include_body')) {
        return makeError(
            'unsupported_field',
            "`include_body` is no longer supported. Use `body_mode: 'auto' | 'schema' | 'head' | 'inline'` (default 'auto'). " +
                "Migration: include_body=true → body_mode='inline'; include_body=false → body_mode='schema'; include_body='auto' → body_mode='auto' (or omit).",
            { field: 'include_body' },
        )
    }

    if (params.download_to && params.body_mode === 'inline') {
        return makeError(
            'invalid_input',
            "download_to is mutually exclusive with body_mode: 'inline'",
        )
    }

    const filesRoot = getConfig().filesRoot
    if (params.download_to) {
        const err = ensureUnderRoot(params.download_to, filesRoot, 'download_to')
        if (err) return err
    }
    if (params.multipart?.files) {
        for (const [key, file] of Object.entries(params.multipart.files)) {
            // content_base64 inline files have no path to canonicalise; skip
            // the FILES_ROOT check (this is the documented behaviour for
            // remote-MCP scenarios where path semantics don't make sense).
            // Use a typeof check rather than `'path' in file` so a
            // schema-bypassing payload like `{content_base64, path: null}`
            // doesn't reach realpathSync(null) downstream.
            if (typeof (file as { path?: unknown }).path !== 'string') continue
            const err = ensureUnderRoot(
                (file as { path: string }).path,
                filesRoot,
                'multipart.files.' + key + '.path',
            )
            if (err) return err
        }
    }

    let runResult: HttpRunResult
    try {
        runResult = await performHttp(params, {})
    } catch (e) {
        return classifyHttpError(e)
    }

    const cache_id = cache.newId()
    const schemaFormat = params.schema_format ?? 'paths'

    let schema: Schema
    if (runResult.body_kind === 'json') {
        schema = renderSchema(schemaFormat, runResult.parsedBody, runResult.bodyBytes)
    } else if (runResult.downloadPath) {
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

    const requestedMode: BodyMode = params.body_mode ?? 'auto'
    const resolution = resolveBodyMode(requestedMode, runResult.body_kind, runResult.bodyBytes)

    if (!resolution.ok) {
        const inner = resolution.error.error
        // Only `body_too_large_for_inline` advertises a recovery path via
        // `http_read` with the surfaced `cache_id`, so only that case
        // populates the cache and splices `cache_id` into the error detail.
        // Other resolution errors (e.g. `body_mode: 'inline'` on a binary
        // response) surface as-is, with no spurious cached entry.
        if (inner.kind === 'body_too_large_for_inline') {
            const body_inclusion: BodyInclusion = buildInclusion(
                'schema',
                'body cached; inline cap exceeded — fetch via http_read with cache_id',
            )
            const meta: ResponseMeta = {
                url: runResult.finalUrl,
                method: params.method,
                duration_ms: runResult.durationMs,
                response_headers: runResult.headers,
                body_bytes: runResult.bodyBytes,
                content_type: runResult.contentType,
                body_kind: runResult.body_kind,
                body_inclusion,
                redirect_chain: runResult.redirectChain,
                download_path: runResult.downloadPath,
            }
            cache.put({
                cache_id,
                created_at: Date.now(),
                body_kind: runResult.body_kind,
                body: runResult.parsedBody,
                status: runResult.status,
                meta,
            })
            return {
                error: {
                    ...inner,
                    detail: { ...(inner.detail ?? {}), cache_id },
                },
            }
        }
        return resolution.error
    }

    const body_inclusion: BodyInclusion = buildInclusion(
        resolution.resolved_mode,
        resolution.reason,
    )

    const meta: ResponseMeta = {
        url: runResult.finalUrl,
        method: params.method,
        duration_ms: runResult.durationMs,
        response_headers: runResult.headers,
        body_bytes: runResult.bodyBytes,
        content_type: runResult.contentType,
        body_kind: runResult.body_kind,
        body_inclusion,
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

    const cfg = getConfig()
    const result: HttpRequestResult = {
        cache_id,
        status: runResult.status,
        meta,
        schema,
        ...(resolution.resolved_mode === 'inline' ? { body: runResult.parsedBody } : {}),
        ...(resolution.resolved_mode === 'head' && runResult.body_kind === 'json'
            ? { body_preview: renderJsonPreview(runResult.parsedBody, cfg) }
            : {}),
        ...(resolution.resolved_mode === 'head' && runResult.body_kind === 'text'
            ? { body_preview: renderTextPreview(runResult.parsedBody as string, cfg) }
            : {}),
        ...(resolution.resolved_mode === 'head' && runResult.body_kind === 'empty'
            ? { body_preview: null }
            : {}),
    }
    if (runResult.body_kind === 'json') {
        const hints = inferNextStepHints(runResult.parsedBody)
        if (hints.length > 0) result.next_step_hints = hints
    }
    return result
}

interface ResolveOk {
    ok: true
    resolved_mode: ResolvedBodyMode
    reason?: string
}
interface ResolveErr {
    ok: false
    error: ReturnType<typeof makeError>
}
type ResolveResult = ResolveOk | ResolveErr

const resolveBodyMode = (requested: BodyMode, kind: BodyKind, bytes: number): ResolveResult => {
    const cfg = getConfig()

    // Binaries are never inlined or previewed inline regardless of mode.
    if (kind === 'binary') {
        if (requested === 'inline') {
            return {
                ok: false,
                error: makeError(
                    'invalid_input',
                    "body_mode: 'inline' is not valid for binary bodies; use download_to or http_read with save_to",
                    { body_kind: kind, body_mode: requested },
                ),
            }
        }
        return { ok: true, resolved_mode: 'schema' }
    }

    // Empty: schema by default (consistent with v0.1.x); explicit modes are
    // honoured but the body is null either way.
    if (kind === 'empty') {
        if (requested === 'auto' || requested === 'schema') {
            return { ok: true, resolved_mode: 'schema' }
        }
        return { ok: true, resolved_mode: requested as ResolvedBodyMode }
    }

    // JSON / text from here on.
    if (requested === 'schema') return { ok: true, resolved_mode: 'schema' }
    if (requested === 'inline') {
        if (bytes > cfg.inlineBodyCapBytes) {
            return {
                ok: false,
                error: makeError(
                    'body_too_large_for_inline',
                    'Body is ' +
                        bytes +
                        ' bytes; refusing to inline (cap ' +
                        cfg.inlineBodyCapBytes +
                        '). The body is cached — use http_read with the returned cache_id to extract fields via a jq mask.',
                    { body_bytes: bytes, inline_body_cap_bytes: cfg.inlineBodyCapBytes },
                ),
            }
        }
        return { ok: true, resolved_mode: 'inline' }
    }
    if (requested === 'head') {
        // Head behaviour is fully wired in a follow-up PR; for now the
        // resolved_mode is reported truthfully but the body_preview field
        // is built downstream.
        return { ok: true, resolved_mode: 'head' }
    }
    // requested === 'auto'
    if (bytes <= cfg.inlineThresholdBytes) {
        return { ok: true, resolved_mode: 'inline' }
    }
    if (bytes <= cfg.headPreviewThresholdBytes) {
        return {
            ok: true,
            resolved_mode: 'head',
            reason:
                'body ' +
                bytes +
                ' B exceeds inline threshold ' +
                cfg.inlineThresholdBytes +
                ' B; auto resolved to head',
        }
    }
    return {
        ok: true,
        resolved_mode: 'schema',
        reason:
            'body ' +
            bytes +
            ' B exceeds head preview threshold ' +
            cfg.headPreviewThresholdBytes +
            ' B; auto resolved to schema',
    }
}

const buildInclusion = (resolved: ResolvedBodyMode, reason?: string): BodyInclusion => {
    const cfg = getConfig()
    return {
        resolved_mode: resolved,
        inline_threshold_bytes: cfg.inlineThresholdBytes,
        head_preview_threshold_bytes: cfg.headPreviewThresholdBytes,
        head_preview_items: cfg.headPreviewItems,
        head_preview_string_chars: cfg.headPreviewStringChars,
        inline_body_cap_bytes: cfg.inlineBodyCapBytes,
        ...(reason ? { reason } : {}),
    }
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
