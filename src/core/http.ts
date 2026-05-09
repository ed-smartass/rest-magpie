import type { Dispatcher } from 'undici'
import { getConfig } from '../config.js'
import type { BodyKind, HttpRequestParams } from '../types.js'
import { classifyContentType, parseCharset } from './content_type.js'

export interface HttpRunResult {
    status: number
    headers: Record<string, string>
    body_kind: BodyKind
    parsedBody: unknown | string | Buffer | null
    contentType: string
    bodyBytes: number
    finalUrl: string
    redirectChain: string[]
    durationMs: number
}

export interface HttpOptions {
    dispatcher?: Dispatcher
}

export const performHttp = async (
    params: HttpRequestParams,
    opts: HttpOptions,
): Promise<HttpRunResult> => {
    const cfg = getConfig()
    const url = buildUrl(params.url, params.query)
    const start = Date.now()

    const headers: Record<string, string> = { ...(params.headers ?? {}) }

    // Body handled in Task 14 (object/string), Task 15 (multipart). For now: only body_raw.
    const body = params.body_raw
    if (body !== undefined && !headers['content-type'] && params.content_type) {
        headers['content-type'] = params.content_type
    }

    const controller = new AbortController()
    const timeoutMs = params.timeout_ms ?? cfg.defaultTimeoutMs
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let res: Response
    try {
        const init: Record<string, unknown> = {
            method: params.method,
            headers,
            body,
            signal: controller.signal,
            redirect: 'manual',
        }
        if (opts.dispatcher) init.dispatcher = opts.dispatcher
        res = await fetch(url, init as RequestInit)
    } finally {
        clearTimeout(timer)
    }

    const ct = res.headers.get('content-type') ?? ''
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > cfg.maxResponseBytes) {
        const e = new Error('response body exceeds MAGPIE_MAX_RESPONSE_BYTES')
        ;(e as { kind?: string }).kind = 'body_too_large'
        throw e
    }

    const kind: BodyKind =
        res.status === 204 || buffer.length === 0 ? 'empty' : classifyContentType(ct)
    let parsed: unknown | string | Buffer | null
    if (kind === 'json') {
        parsed = JSON.parse(buffer.toString('utf8'))
    } else if (kind === 'text') {
        parsed = buffer.toString((parseCharset(ct) ?? 'utf8') as BufferEncoding)
    } else if (kind === 'empty') {
        parsed = null
    } else {
        parsed = buffer
    }

    return {
        status: res.status,
        headers: flattenHeaders(res.headers),
        body_kind: kind,
        parsedBody: parsed,
        contentType: ct,
        bodyBytes: buffer.length,
        finalUrl: url,
        redirectChain: [],
        durationMs: Date.now() - start,
    }
}

const buildUrl = (rawUrl: string, query?: Record<string, string | string[]>): string => {
    let u: URL
    try {
        u = new URL(rawUrl)
    } catch {
        const e = new Error('invalid_url')
        ;(e as { kind?: string }).kind = 'invalid_url'
        throw e
    }
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            if (Array.isArray(v)) for (const vv of v) u.searchParams.append(k, vv)
            else u.searchParams.append(k, v)
        }
    }
    return u.toString()
}

const flattenHeaders = (h: Headers): Record<string, string> => {
    const out: Record<string, string> = {}
    h.forEach((v, k) => {
        out[k.toLowerCase()] = v
    })
    return out
}
