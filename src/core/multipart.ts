import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import { Readable } from 'node:stream'
import type { MultipartInput } from '../types.js'

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
interface PreparedFile {
    safeName: string
    safeFilename: string
    safeCt: string
    path: string
}

export const buildMultipart = (mp: MultipartInput): BuiltMultipart => {
    const boundary = '----magpie' + randomBytes(12).toString('hex')

    // Validate and sanitise every header-position string EAGERLY so a
    // malicious input fails the call before any HTTP request is started.
    // Doing this only inside the async generator means the throw fires
    // during stream consumption, which is too late for callers and
    // surprises tests that just call buildMultipart().
    const fields: PreparedField[] = []
    for (const [k, v] of Object.entries(mp.fields ?? {})) {
        fields.push({ safeName: quoteFieldValue(k, 'multipart.fields key'), value: v })
    }
    const files: PreparedFile[] = []
    for (const [k, f] of Object.entries(mp.files ?? {})) {
        const filename = f.filename ?? basename(f.path)
        const ct = f.content_type ?? 'application/octet-stream'
        files.push({
            safeName: quoteFieldValue(k, 'multipart.files key'),
            safeFilename: quoteFieldValue(filename, 'multipart.files.' + k + '.filename'),
            safeCt: sanitizeHeaderValue(ct, 'multipart.files.' + k + '.content_type'),
            path: f.path,
        })
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
            for await (const chunk of createReadStream(f.path)) {
                yield chunk as Buffer
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
