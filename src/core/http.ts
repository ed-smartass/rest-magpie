import { Agent, type Dispatcher } from 'undici'
import { getConfig } from '../config.js'
import type { BodyKind, HttpRequestParams } from '../types.js'
import { classifyContentType, parseCharset } from './content_type.js'
import { buildMultipart } from './multipart.js'

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
    downloadPath?: string
    sha256?: string
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

    const { body, contentType: bodyCt } = resolveBody(params)
    if (body !== undefined && !headers['content-type']) {
        headers['content-type'] = params.content_type ?? bodyCt ?? 'application/octet-stream'
    }

    const insecure = params.tls_insecure ?? cfg.tlsInsecure
    const dispatcher: Dispatcher | undefined =
        opts.dispatcher ??
        (insecure ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined)

    const followLimit = (params.follow_redirects ?? true) ? 10 : 0
    const redirectChain: string[] = []
    let currentUrl = url
    let resp: Response | undefined

    for (let i = 0; i <= followLimit; i++) {
        const init: Record<string, unknown> = {
            method: params.method,
            headers,
            body,
            redirect: 'manual',
            signal: AbortSignal.timeout(params.timeout_ms ?? cfg.defaultTimeoutMs),
        }
        if (dispatcher) init.dispatcher = dispatcher

        resp = await fetch(currentUrl, init as RequestInit)

        const loc = resp.headers.get('location')
        if (resp.status >= 300 && resp.status < 400 && loc && i < followLimit) {
            const next = new URL(loc, currentUrl).toString()
            redirectChain.push(next)
            currentUrl = next
            continue
        }
        break
    }

    if (!resp) {
        const e = new Error('network_error: no response')
        ;(e as { kind?: string }).kind = 'network_error'
        throw e
    }

    if (
        redirectChain.length >= 10 &&
        resp.status >= 300 &&
        resp.status < 400 &&
        resp.headers.get('location')
    ) {
        const e = new Error('redirect_loop')
        ;(e as { kind?: string }).kind = 'redirect_loop'
        throw e
    }

    // Stream the body and enforce MAGPIE_MAX_RESPONSE_BYTES early.
    const reader = resp.body?.getReader()
    let total = 0

    if (params.download_to) {
        const fs = await import('node:fs')
        const { createHash } = await import('node:crypto')
        const stream = fs.createWriteStream(params.download_to)
        const hasher = createHash('sha256')
        if (reader) {
            for (;;) {
                const { value, done } = await reader.read()
                if (done) break
                if (value) {
                    total += value.length
                    if (total > cfg.maxResponseBytes) {
                        reader.cancel().catch(() => {})
                        stream.destroy()
                        const e = new Error('body_too_large')
                        ;(e as { kind?: string }).kind = 'body_too_large'
                        throw e
                    }
                    stream.write(Buffer.from(value))
                    hasher.update(value)
                }
            }
        }
        await new Promise<void>((res, rej) =>
            stream.end((err: Error | null | undefined) => (err ? rej(err) : res())),
        )
        const ct = resp.headers.get('content-type') ?? ''
        return {
            status: resp.status,
            headers: flattenHeaders(resp.headers),
            body_kind: 'binary',
            parsedBody: null,
            contentType: ct,
            bodyBytes: total,
            finalUrl: currentUrl,
            redirectChain,
            durationMs: Date.now() - start,
            downloadPath: params.download_to,
            sha256: hasher.digest('hex'),
        }
    }

    const chunks: Uint8Array[] = []
    if (reader) {
        for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            if (value) {
                total += value.length
                if (total > cfg.maxResponseBytes) {
                    reader.cancel().catch(() => {})
                    const e = new Error('body_too_large')
                    ;(e as { kind?: string }).kind = 'body_too_large'
                    throw e
                }
                chunks.push(value)
            }
        }
    }
    const buffer = Buffer.concat(chunks.map((u) => Buffer.from(u)))

    const ct = resp.headers.get('content-type') ?? ''
    const kind: BodyKind =
        resp.status === 204 || buffer.length === 0 ? 'empty' : classifyContentType(ct)

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
        status: resp.status,
        headers: flattenHeaders(resp.headers),
        body_kind: kind,
        parsedBody: parsed,
        contentType: ct,
        bodyBytes: buffer.length,
        finalUrl: currentUrl,
        redirectChain,
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

interface ResolvedBody {
    body: string | Buffer | undefined
    contentType?: string
}

const resolveBody = (p: HttpRequestParams): ResolvedBody => {
    const set = (['body', 'body_raw', 'multipart'] as const).filter(
        (k) => (p as unknown as Record<string, unknown>)[k] !== undefined,
    )
    if (set.length > 1) {
        const e = new Error('invalid_input: only one of body | body_raw | multipart allowed')
        ;(e as { kind?: string }).kind = 'invalid_input'
        throw e
    }
    if (p.body !== undefined) {
        if (typeof p.body === 'string') {
            return { body: p.body, contentType: 'text/plain; charset=utf-8' }
        }
        return { body: JSON.stringify(p.body), contentType: 'application/json' }
    }
    if (p.body_raw !== undefined) {
        return { body: p.body_raw, contentType: undefined }
    }
    if (p.multipart !== undefined) {
        const built = buildMultipart(p.multipart)
        return { body: built.body, contentType: built.contentType }
    }
    return { body: undefined }
}
