import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { buildMultipart } from '../../src/core/multipart.js'

const drainBody = async (body: Readable): Promise<Buffer> => {
    const chunks: Buffer[] = []
    for await (const c of body) chunks.push(c as Buffer)
    return Buffer.concat(chunks)
}

describe('buildMultipart', () => {
    it('encodes fields and files with proper boundaries', async () => {
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
        const buf = await drainBody(body)
        const text = buf.toString('utf8')
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

    it('falls back to basename + octet-stream when fields missing', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'magpie-mp-'))
        const p = join(dir, 'data.bin')
        writeFileSync(p, 'abc')
        const { body, contentType } = buildMultipart({
            files: { f: { path: p } },
        })
        expect(contentType).toContain('multipart/form-data')
        const buf = await drainBody(body)
        const text = buf.toString('utf8')
        expect(text).toContain('filename="data.bin"')
        expect(text).toContain('Content-Type: application/octet-stream')
    })

    it('rejects CR/LF in field name (header injection guard)', () => {
        expect(() =>
            buildMultipart({
                fields: { 'name\r\nX-Injected: yes': 'alice' },
            }),
        ).toThrow(/illegal control character/)
    })

    it('rejects CR/LF in filename (header injection guard)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'magpie-mp-'))
        const p = join(dir, 'a.bin')
        writeFileSync(p, 'x')
        expect(() =>
            buildMultipart({
                files: {
                    f: { path: p, filename: 'evil\r\nContent-Type: text/html' },
                },
            }),
        ).toThrow(/illegal control character/)
    })

    it('rejects CR/LF in content_type (header injection guard)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'magpie-mp-'))
        const p = join(dir, 'a.bin')
        writeFileSync(p, 'x')
        expect(() =>
            buildMultipart({
                files: {
                    f: { path: p, content_type: 'text/plain\r\nX-Bad: yes' },
                },
            }),
        ).toThrow(/illegal control character/)
    })

    it('escapes backslash and quote in filename per RFC 7578', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'magpie-mp-'))
        const p = join(dir, 'a.bin')
        writeFileSync(p, 'x')
        const { body } = buildMultipart({
            files: {
                f: { path: p, filename: 'name "with" \\backslash.txt' },
            },
        })
        const text = (await drainBody(body)).toString('utf8')
        expect(text).toContain('filename="name \\"with\\" \\\\backslash.txt"')
    })

    it('encodes content_base64 inline file', async () => {
        const payload = Buffer.from('inline-bytes', 'utf8').toString('base64')
        const { body } = buildMultipart({
            files: {
                photo: {
                    content_base64: payload,
                    filename: 'photo.txt',
                    content_type: 'text/plain',
                },
            },
        })
        const text = (await drainBody(body)).toString('utf8')
        expect(text).toContain('filename="photo.txt"')
        expect(text).toContain('Content-Type: text/plain')
        expect(text).toContain('inline-bytes')
    })

    it('rejects when both path and content_base64 supplied', () => {
        const dir = mkdtempSync(join(tmpdir(), 'magpie-mp-'))
        const p = join(dir, 'a.bin')
        writeFileSync(p, 'x')
        expect(() =>
            buildMultipart({
                files: {
                    // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
                    f: { path: p, content_base64: 'aGVsbG8=' } as any,
                },
            }),
        ).toThrow(/exactly one/)
    })

    it('rejects when neither path nor content_base64 supplied', () => {
        expect(() =>
            buildMultipart({
                // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
                files: { f: {} as any },
            }),
        ).toThrow(/exactly one/)
    })

    it('rejects malformed base64 (non-alphabet characters)', () => {
        expect(() =>
            buildMultipart({
                files: {
                    f: { content_base64: 'not!valid$base64', filename: 'x.bin' },
                },
            }),
        ).toThrow(/not valid base64/)
    })

    it('rejects malformed base64 (wrong length / padding)', () => {
        // 'abc' is 3 chars, not a multiple of 4 — rejected.
        expect(() =>
            buildMultipart({
                files: {
                    f: { content_base64: 'abc', filename: 'x.bin' },
                },
            }),
        ).toThrow(/not valid base64/)
    })

    it('rejects non-string content_base64', () => {
        expect(() =>
            buildMultipart({
                files: {
                    // biome-ignore lint/suspicious/noExplicitAny: schema-bypass simulation
                    f: { content_base64: 12345 as any, filename: 'x.bin' },
                },
            }),
        ).toThrow(/must be a string/)
    })
})
