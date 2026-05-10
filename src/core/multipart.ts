import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import { Readable } from 'node:stream'
import { getConfig } from '../config.js'
import type { MultipartFile, MultipartInput } from '../types.js'

export interface BuiltMultipart {
    body: Readable
    contentType: string
}

// CR / LF / NUL in a header value would let a caller inject arbitrary
// HTTP headers (header smuggling). Refuse the request loud rather than
// silently strip — the agent should know its input was rejected.
const sanitizeHeaderValue = (s: string, where: string): string => {
    if (/[\r\n\0]/.test(s)) {
        const e = new Error(
            'invalid_input: ' + where + ' contains illegal control character (\\r, \\n, or \\0)',
        )
        ;(e as { kind?: string }).kind = 'invalid_input'
        throw e
    }
    return s
}

// RFC 7578 §4.2: backslash and double-quote in name= / filename= must be
// escaped. We also defensively pass the value through sanitizeHeaderValue.
const quoteFieldValue = (s: string, where: string): string =>
    sanitizeHeaderValue(s, where).replace(/[\\"]/g, '\\$&')

interface PreparedField {
    safeName: string
    value: string
}
type PreparedFile =
    | {
          source: 'path'
          safeName: string
          safeFilename: string
          safeCt: string
          path: string
      }
    | {
          source: 'inline'
          safeName: string
          safeFilename: string
          safeCt: string
          buffer: Buffer
      }

const isInlineFile = (f: MultipartFile): f is Extract<MultipartFile, { content_base64: string }> =>
    'content_base64' in f

// `Buffer.from(s, 'base64')` does NOT throw on malformed input — it silently
// strips invalid characters and decodes the rest. To give callers a real
// "you sent garbage" signal we validate the alphabet + length up front.
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

const decodeBase64 = (s: unknown, where: string, capBytes: number): Buffer => {
    if (typeof s !== 'string') {
        const e = new Error('invalid_input: ' + where + ' must be a string')
        ;(e as { kind?: string }).kind = 'invalid_input'
        throw e
    }
    // Cheap length-based pre-check BEFORE allocating the decoded buffer.
    // base64 expands ~4/3 vs raw bytes (4 chars per 3 bytes), so the
    // largest legal encoded length for our cap is ceil(cap/3)*4 + slack
    // for padding. Reject otherwise — a 1 GB base64 string would OOM
    // before the post-decode cap check otherwise.
    const maxEncodedLength = Math.ceil(capBytes / 3) * 4 + 4
    if (s.length > maxEncodedLength) {
        const e = new Error(
            'invalid_input: ' +
                where +
                ' encoded size ' +
                s.length +
                ' chars implies decoded > MAGPIE_MAX_INLINE_FILE_BYTES (' +
                capBytes +
                ' B). Use multipart.files[].path with a volume mount instead, or raise the cap.',
        )
        ;(e as { kind?: string }).kind = 'invalid_input'
        throw e
    }
    if (s.length % 4 !== 0 || !BASE64_RE.test(s)) {
        const e = new Error('invalid_input: ' + where + ' is not valid base64')
        ;(e as { kind?: string }).kind = 'invalid_input'
        throw e
    }
    const buf = Buffer.from(s, 'base64')
    if (buf.length > capBytes) {
        const e = new Error(
            'invalid_input: ' +
                where +
                ' decoded size ' +
                buf.length +
                ' B exceeds MAGPIE_MAX_INLINE_FILE_BYTES (' +
                capBytes +
                ' B). Use multipart.files[].path with a volume mount instead, or raise the cap.',
        )
        ;(e as { kind?: string }).kind = 'invalid_input'
        throw e
    }
    return buf
}

export const buildMultipart = (mp: MultipartInput): BuiltMultipart => {
    const boundary = '----magpie' + randomBytes(12).toString('hex')
    const cfg = getConfig()

    // Validate and sanitise every header-position string EAGERLY so a
    // malicious input fails the call before any HTTP request is started.
    const fields: PreparedField[] = []
    for (const [k, v] of Object.entries(mp.fields ?? {})) {
        fields.push({ safeName: quoteFieldValue(k, 'multipart.fields key'), value: v })
    }
    const files: PreparedFile[] = []
    for (const [k, f] of Object.entries(mp.files ?? {})) {
        // Validate that exactly one of path / content_base64 is supplied.
        const hasPath = 'path' in f && typeof f.path === 'string'
        const hasInline = isInlineFile(f)
        if (hasPath && hasInline) {
            const e = new Error(
                'invalid_input: multipart.files.' +
                    k +
                    ' must specify exactly one of path or content_base64 (both supplied)',
            )
            ;(e as { kind?: string }).kind = 'invalid_input'
            throw e
        }
        if (!hasPath && !hasInline) {
            const e = new Error(
                'invalid_input: multipart.files.' +
                    k +
                    ' must specify exactly one of path or content_base64',
            )
            ;(e as { kind?: string }).kind = 'invalid_input'
            throw e
        }

        const ct = f.content_type ?? 'application/octet-stream'
        const safeName = quoteFieldValue(k, 'multipart.files key')
        const safeCt = sanitizeHeaderValue(ct, 'multipart.files.' + k + '.content_type')

        if (hasInline) {
            const filename = f.filename ?? 'upload.bin'
            const buffer = decodeBase64(
                f.content_base64,
                'multipart.files.' + k + '.content_base64',
                cfg.maxInlineFileBytes,
            )
            files.push({
                source: 'inline',
                safeName,
                safeFilename: quoteFieldValue(filename, 'multipart.files.' + k + '.filename'),
                safeCt,
                buffer,
            })
        } else {
            const pathFile = f as Extract<MultipartFile, { path: string }>
            const filename = pathFile.filename ?? basename(pathFile.path)
            files.push({
                source: 'path',
                safeName,
                safeFilename: quoteFieldValue(filename, 'multipart.files.' + k + '.filename'),
                safeCt,
                path: pathFile.path,
            })
        }
    }

    async function* gen(): AsyncGenerator<Buffer> {
        for (const f of fields) {
            yield Buffer.from(
                '--' +
                    boundary +
                    '\r\n' +
                    'Content-Disposition: form-data; name="' +
                    f.safeName +
                    '"\r\n\r\n' +
                    f.value +
                    '\r\n',
            )
        }
        for (const f of files) {
            yield Buffer.from(
                '--' +
                    boundary +
                    '\r\n' +
                    'Content-Disposition: form-data; name="' +
                    f.safeName +
                    '"; filename="' +
                    f.safeFilename +
                    '"\r\n' +
                    'Content-Type: ' +
                    f.safeCt +
                    '\r\n\r\n',
            )
            if (f.source === 'path') {
                for await (const chunk of createReadStream(f.path)) {
                    yield chunk as Buffer
                }
            } else {
                yield f.buffer
            }
            yield Buffer.from('\r\n')
        }
        yield Buffer.from('--' + boundary + '--\r\n')
    }

    return {
        body: Readable.from(gen()),
        contentType: 'multipart/form-data; boundary=' + boundary,
    }
}
