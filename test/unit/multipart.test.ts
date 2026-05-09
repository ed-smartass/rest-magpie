import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildMultipart } from '../../src/core/multipart.js'

describe('buildMultipart', () => {
    it('encodes fields and files with proper boundaries', () => {
        const dir = mkdtempSync(join(tmpdir(), 'magpie-mp-'))
        const filePath = join(dir, 'hello.txt')
        writeFileSync(filePath, 'hello world', 'utf8')

        const { body, contentType } = buildMultipart({
            fields: { name: 'alice' },
            files: {
                upload: { path: filePath, filename: 'hello.txt', content_type: 'text/plain' },
            },
        })
        expect(contentType).toMatch(/^multipart\/form-data; boundary=/)
        const boundary = contentType.split('boundary=')[1]
        const text = body.toString('utf8')
        expect(text).toContain('--' + boundary + '\r\n')
        expect(text).toContain('Content-Disposition: form-data; name="name"\r\n')
        expect(text).toContain('alice\r\n')
        expect(text).toContain(
            'Content-Disposition: form-data; name="upload"; filename="hello.txt"\r\n',
        )
        expect(text).toContain('Content-Type: text/plain\r\n')
        expect(text).toContain('hello world\r\n')
        expect(text).toContain('--' + boundary + '--\r\n')
    })

    it('falls back to basename + octet-stream when fields missing', () => {
        const dir = mkdtempSync(join(tmpdir(), 'magpie-mp-'))
        const p = join(dir, 'data.bin')
        writeFileSync(p, 'abc')
        const { body, contentType } = buildMultipart({
            files: { f: { path: p } },
        })
        expect(contentType).toContain('multipart/form-data')
        const text = body.toString('utf8')
        expect(text).toContain('filename="data.bin"')
        expect(text).toContain('Content-Type: application/octet-stream')
    })
})
