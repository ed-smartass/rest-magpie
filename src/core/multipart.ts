import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import { Readable } from 'node:stream'
import type { MultipartInput } from '../types.js'

export interface BuiltMultipart {
    body: Readable
    contentType: string
}

export const buildMultipart = (mp: MultipartInput): BuiltMultipart => {
    const boundary = '----magpie' + randomBytes(12).toString('hex')

    async function* gen(): AsyncGenerator<Buffer> {
        for (const [k, v] of Object.entries(mp.fields ?? {})) {
            yield Buffer.from(
                '--' +
                    boundary +
                    '\r\n' +
                    'Content-Disposition: form-data; name="' +
                    k +
                    '"\r\n\r\n' +
                    v +
                    '\r\n',
            )
        }
        for (const [k, f] of Object.entries(mp.files ?? {})) {
            const filename = f.filename ?? basename(f.path)
            const ct = f.content_type ?? 'application/octet-stream'
            yield Buffer.from(
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
