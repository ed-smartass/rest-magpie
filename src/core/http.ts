import type { Readable } from 'node:stream'
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

// Lowercase all incoming header names so internal lookups can be a single
// case-sensitive comparison and we don't accidentally double-set headers
// (e.g. caller passes "Content-Type", we then add "content-type"). HTTP
// header names are case-insensitive on the wire so this is RFC-correct.
const normalizeHeaders = (h: Record<string, string> | undefined): Record<string, string> => {
    const out: Record<string, string> = {}
    if (!h) return out
    for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v
    return out
}

export const performHttp = async (
    params: HttpRequestParams,
    opts: HttpOptions,
): Promise<HttpRunResult> => {
    const cfg = getConfig()
    const url = buildUrl(params.url, params.query)
    const start = Date.now()

    const initialHeaders = normalizeHeaders(params.headers)

    const { body, contentType: bodyCt } = resolveBody(params)
    if (body !== undefined && initialHeaders['content-type'] === undefined) {
        initialHeaders['content-type'] = params.content_type ?? bodyCt ?? 'application/octet-stream'
    }

    const insecure = params.tls_insecure ?? cfg.tlsInsecure
    const dispatcher: Dispatcher | undefined =
        opts.dispatcher ??
        (insecure ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined)

    const followLimit = (params.follow_redirects ?? true) ? 10 : 0
    const redirectChain: string[] = []
    let currentUrl = url
    let currentMethod = params.method
    let currentBody: typeof body = body
    let currentHeaders: Record<string, string> = { ...initialHeaders }
    let resp: Response | undefined

    for (let i = 0; i <= followLimit; i++) {
        const init: Record<string, unknown> = {
            method: currentMethod,
            headers: currentHeaders,
            body: currentBody,
            redirect: 'manual',
            signal: AbortSignal.timeout(params.timeout_ms ?? cfg.defaultTimeoutMs),
        }
        if (
            currentBody !== undefined &&
            typeof currentBody !== 'string' &&
            !Buffer.isBuffer(currentBody)
        ) {
            init.duplex = 'half'
        }
        if (dispatcher) init.dispatcher = dispatcher

        resp = await fetch(currentUrl, init as RequestInit)

        const loc = resp.headers.get('location')
        if (resp.status >= 300 && resp.status < 400 && loc && i < followLimit) {
            const next = new URL(loc, currentUrl).toString()
            redirectChain.push(next)
            currentUrl = next

            // RFC 7231 §6.4: 301/302/303 invariably downgrade unsafe methods
            // to GET and drop the request body when followed. 307/308
            // explicitly preserve method+body. We deliberately don't try to
            // be clever — match the spec letter so callers are not surprised.
            const isMethodChangingStatus =
                resp.status === 301 || resp.status === 302 || resp.status === 303
            const isPreserveStatus = resp.status === 307 || resp.status === 308
            const isUnsafe = currentMethod !== 'GET' && currentMethod !== 'HEAD'
            const isStreamedBody =
                currentBody !== undefined &&
                typeof currentBody !== 'string' &&
                !Buffer.isBuffer(currentBody)

            // 307/308 preserve method+body, but a Readable body (multipart
            // upload) was consumed by the first fetch — replaying it would
            // throw "Response body object should not be disturbed or locked"
            // from undici. Surface a clear `invalid_input` so the caller can
            // re-issue against the final URL directly.
            if (isPreserveStatus && isStreamedBody) {
                const e = new Error(
                    'invalid_input: cannot follow ' +
                        resp.status +
                        ' redirect — the original request used a streamed body (multipart) which cannot be replayed. Re-issue the request directly to ' +
                        next +
                        '.',
                )
                ;(e as { kind?: string }).kind = 'invalid_input'
                throw e
            }

            if (isMethodChangingStatus && isUnsafe) {
                currentMethod = 'GET'
                currentBody = undefined
                // Drop ALL content-* headers since they describe an entity-body
                // we are no longer transmitting (RFC 7231 §6.4 implication).
                // Catches content-type, content-length, content-encoding,
                // content-language, content-md5, etc.
                const next: Record<string, string> = {}
                for (const [k, v] of Object.entries(currentHeaders)) {
                    if (!k.startsWith('content-')) next[k] = v
                }
                currentHeaders = next
            }
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

    // Stream the body and enforce PEEK_MAX_RESPONSE_BYTES early.
    const reader = resp.body?.getReader()
    let total = 0

    if (params.download_to) {
        const fs = await import('node:fs')
        const fsp = await import('node:fs/promises')
        const { createHash } = await import('node:crypto')
        const stream = fs.createWriteStream(params.download_to)
        const hasher = createHash('sha256')

        // Surface stream errors deterministically — without a listener,
        // 'error' on a destroyed write stream goes to uncaughtException.
        let streamError: Error | undefined
        stream.on('error', (e: Error) => {
            streamError = e
        })

        const writeWithBackpressure = async (chunk: Buffer): Promise<void> => {
            if (!stream.write(chunk) && !stream.destroyed) {
                // Race 'drain' against 'error'/'close'. Without this, an
                // error during backpressure (disk full, EPERM, EBADF) means
                // 'drain' never fires and the await hangs forever.
                await new Promise<void>((res, rej) => {
                    const onDrain = () => {
                        stream.removeListener('error', onError)
                        stream.removeListener('close', onClose)
                        res()
                    }
                    const onError = (e: Error) => {
                        stream.removeListener('drain', onDrain)
                        stream.removeListener('close', onClose)
                        rej(e)
                    }
                    const onClose = () => {
                        stream.removeListener('drain', onDrain)
                        stream.removeListener('error', onError)
                        rej(streamError ?? new Error('stream closed before drain'))
                    }
                    stream.once('drain', onDrain)
                    stream.once('error', onError)
                    stream.once('close', onClose)
                })
            }
        }

        const cleanupPartial = async (): Promise<void> => {
            try {
                await fsp.unlink(params.download_to as string)
            } catch {
                // Best-effort: file might not exist yet, or deletion blocked.
            }
        }

        try {
            if (reader) {
                for (;;) {
                    const { value, done } = await reader.read()
                    if (done) break
                    if (value) {
                        total += value.length
                        if (total > cfg.maxResponseBytes) {
                            reader.cancel().catch(() => {})
                            stream.destroy()
                            await cleanupPartial()
                            const e = new Error('body_too_large')
                            ;(e as { kind?: string }).kind = 'body_too_large'
                            throw e
                        }
                        await writeWithBackpressure(Buffer.from(value))
                        hasher.update(value)
                    }
                }
            }
            await new Promise<void>((res, rej) =>
                stream.end((err: Error | null | undefined) => (err ? rej(err) : res())),
            )
            if (streamError) throw streamError
        } catch (err) {
            // If a write error surfaced mid-stream and we haven't already
            // tagged & cleaned up, do so before rethrowing.
            const tagged = (err as { kind?: string }).kind
            if (!tagged) await cleanupPartial()
            throw err
        }

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
    body: string | Buffer | Readable | undefined
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
        if (p.content_type === undefined) {
            const e = new Error('invalid_input: body_raw requires content_type')
            ;(e as { kind?: string }).kind = 'invalid_input'
            throw e
        }
        return { body: p.body_raw, contentType: undefined }
    }
    if (p.multipart !== undefined) {
        const built = buildMultipart(p.multipart)
        return { body: built.body, contentType: built.contentType }
    }
    return { body: undefined }
}
