import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const send = (child: ChildProcess, msg: object) => {
    if (child.stdin) child.stdin.write(JSON.stringify(msg) + '\n')
}

interface JsonRpcMessage {
    id?: number
    result?: { tools?: { name: string }[]; content?: { type: string; text: string }[] }
    error?: unknown
}

const collectResponses = (child: ChildProcess): JsonRpcMessage[] => {
    const messages: JsonRpcMessage[] = []
    let buf = ''
    child.stdout?.on('data', (chunk: Buffer) => {
        buf += chunk.toString()
        let idx = buf.indexOf('\n')
        while (idx !== -1) {
            const line = buf.slice(0, idx).trim()
            buf = buf.slice(idx + 1)
            if (line) {
                try {
                    messages.push(JSON.parse(line))
                } catch {
                    // Ignore non-JSON lines (e.g. log noise on stderr piped weirdly).
                }
            }
            idx = buf.indexOf('\n')
        }
    })
    return messages
}

const waitForN = async (messages: JsonRpcMessage[], n: number, timeoutMs = 5000): Promise<void> => {
    const start = Date.now()
    while (messages.length < n && Date.now() - start < timeoutMs) {
        await wait(50)
    }
}

describe('MCP stdio black-box smoke', () => {
    let httpServer: Server
    let port: number

    beforeAll(async () => {
        httpServer = createServer((req, res) => {
            if (req.url === '/redirect') {
                res.writeHead(302, { location: '/final' })
                res.end()
                return
            }
            if (req.url === '/final') {
                res.writeHead(200, { 'content-type': 'application/json' })
                res.end(JSON.stringify({ ok: true, where: 'final' }))
                return
            }
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ hello: 'world', count: 1 }))
        })
        await new Promise<void>((r) => httpServer.listen(0, () => r()))
        const addr = httpServer.address()
        port = (addr as { port: number }).port
    })

    afterAll(() => new Promise<void>((r) => httpServer.close(() => r())))

    it('initialize → tools/list → http_request against real server', async () => {
        const child = spawn('node', ['dist/index.js'], { stdio: ['pipe', 'pipe', 'inherit'] })
        const messages = collectResponses(child)

        send(child, {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'smoke', version: '0' },
            },
        })
        send(child, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
        send(child, {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
                name: 'http_request',
                arguments: {
                    method: 'GET',
                    url: 'http://localhost:' + port + '/hi',
                },
            },
        })

        await waitForN(messages, 3)
        child.kill()

        expect(messages.length).toBeGreaterThanOrEqual(3)

        const list = messages.find((m) => m.id === 2)
        expect(list?.result?.tools?.map((t) => t.name).sort()).toEqual([
            'http_inspect',
            'http_read',
            'http_request',
            'server_info',
        ])

        const call = messages.find((m) => m.id === 3)
        expect(call?.result?.content?.[0]?.type).toBe('text')
        const result = JSON.parse(call?.result?.content?.[0]?.text as string)
        expect(result.status).toBe(200)
        expect(result.meta.body_kind).toBe('json')
    }, 15000)

    it('redirects are followed against real server', async () => {
        const child = spawn('node', ['dist/index.js'], { stdio: ['pipe', 'pipe', 'inherit'] })
        const messages = collectResponses(child)

        send(child, {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'smoke', version: '0' },
            },
        })
        send(child, {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
                name: 'http_request',
                arguments: {
                    method: 'GET',
                    url: 'http://localhost:' + port + '/redirect',
                },
            },
        })

        await waitForN(messages, 2)
        child.kill()

        const call = messages.find((m) => m.id === 2)
        const result = JSON.parse(call?.result?.content?.[0]?.text as string)
        expect(result.status).toBe(200)
        expect(result.meta.redirect_chain).toContain('http://localhost:' + port + '/final')
    }, 15000)

    // Regression: npx and `npm install -g` invoke the bin via a symlink in
    // node_modules/.bin/, so process.argv[1] differs from the real dist path.
    // The entrypoint guard must compare resolved real paths, not raw strings.
    it('boots when invoked through a symlink (npx/.bin pattern)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'mcp-peek-bin-'))
        const link = join(dir, 'mcp-peek')
        symlinkSync(resolve('dist/index.js'), link)
        try {
            const child = spawn('node', [link], { stdio: ['pipe', 'pipe', 'inherit'] })
            const messages = collectResponses(child)
            send(child, {
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: { name: 'smoke', version: '0' },
                },
            })
            await waitForN(messages, 1)
            child.kill()
            const init = messages.find((m) => m.id === 1)
            expect(init?.result).toBeDefined()
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    }, 15000)
})
