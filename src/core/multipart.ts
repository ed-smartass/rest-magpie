import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { MultipartInput } from '../types.js'

export interface BuiltMultipart {
    body: Buffer
    contentType: string
}

export const buildMultipart = (mp: MultipartInput): BuiltMultipart => {
    const boundary = '----magpie' + randomBytes(12).toString('hex')
    const chunks: Buffer[] = []
    for (const [k, v] of Object.entries(mp.fields ?? {})) {
        chunks.push(
            Buffer.from(
                '--' +
                    boundary +
                    '\r\n' +
                    'Content-Disposition: form-data; name="' +
                    k +
                    '"\r\n\r\n' +
                    v +
                    '\r\n',
            ),
        )
    }
    for (const [k, f] of Object.entries(mp.files ?? {})) {
        const filename = f.filename ?? basename(f.path)
        const ct = f.content_type ?? 'application/octet-stream'
        chunks.push(
            Buffer.from(
                '--' +
                    boundary +
                    '\r\n' +
                    'Content-Disposition: form-data; name="' +
                    k +
                    '"; filename="' +
                    filename +
                    '"\r\n' +
                    'Content-Type: ' +
                    ct +
                    '\r\n\r\n',
            ),
        )
        chunks.push(readFileSync(f.path))
        chunks.push(Buffer.from('\r\n'))
    }
    chunks.push(Buffer.from('--' + boundary + '--\r\n'))
    return {
        body: Buffer.concat(chunks),
        contentType: 'multipart/form-data; boundary=' + boundary,
    }
}
