import { getConfig } from '../config.js'
import type { JqOutputMode } from '../types.js'

// jq-wasm@^1.0.x exposes:
//   raw(data: string | object, filter: string, flags?: string[]): Promise<string>
//   json(data: string | object, filter: string, flags?: string[]): Promise<unknown>
// We use raw() to keep multi-output handling (newline-separated JSONL) under
// our own control and to get verbatim jq error messages we can classify.
//
// PEEK_USE_NATIVE_JQ env-toggle is documented in spec §7 but the actual
// node-jq engine is backlogged to v0.2+ (spec §15). The native path will plug
// in here — a thin if-branch around getJq() — when that work lands.

type JqRaw = (data: string | object, filter: string, flags?: string[]) => Promise<string>

let jqInstance: JqRaw | undefined
const getJq = async (): Promise<JqRaw> => {
    if (!jqInstance) {
        const mod = await import('jq-wasm')
        jqInstance = mod.raw
    }
    return jqInstance
}

export type JqOk = { ok: true; value: unknown }
export type JqErr = {
    ok: false
    kind: 'jq_syntax_error' | 'jq_runtime_error' | 'jq_timeout'
    message: string
}
export type JqResult = JqOk | JqErr

// Custom error class for jq timeouts. A class lets classifyError check
// `instanceof` rather than substring-matching the error message — the latter
// would misclassify if a runtime error message happened to contain the
// sentinel string verbatim.
class JqTimeoutError extends Error {
    constructor() {
        super('jq evaluation timed out')
        this.name = 'JqTimeoutError'
    }
}

export const runJq = async (
    parsed: unknown,
    expr: string,
    mode: JqOutputMode,
): Promise<JqResult> => {
    const cfg = getConfig()
    let timer: NodeJS.Timeout | undefined
    try {
        const jq = await getJq()
        const inputStr = JSON.stringify(parsed)
        const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new JqTimeoutError()), cfg.jqTimeoutMs)
            if (typeof timer.unref === 'function') timer.unref()
        })
        // Use -c so each output is a single compact JSON value per line.
        const out = await Promise.race([jq(inputStr, expr, ['-c']), timeoutPromise])
        return { ok: true, value: collect(out, mode) }
    } catch (err: unknown) {
        return classifyError(err)
    } finally {
        if (timer) clearTimeout(timer)
    }
}

const collect = (raw: string, mode: JqOutputMode): unknown => {
    const lines = raw.split(/\r?\n/).filter((l) => l.length > 0)
    const values = lines.map((l) => JSON.parse(l))
    if (mode === 'first') {
        // Return null (not undefined) on empty output: undefined disappears
        // when the result is JSON-serialised, leaving the agent with a
        // misleadingly-empty response.
        return values.length > 0 ? values[0] : null
    }
    if (values.length === 1) return values[0]
    return values
}

const classifyError = (err: unknown): JqErr => {
    if (err instanceof JqTimeoutError) {
        return { ok: false, kind: 'jq_timeout', message: 'jq evaluation timed out' }
    }
    const msg = err instanceof Error ? err.message : String(err)
    // jq-wasm 1.0.x error message shapes (verified empirically):
    //   syntax: "jq: error: syntax error, ... \njq: 1 compile error"
    //   runtime: "jq: error (at /dev/stdin:LINE): <reason>"
    // Check syntax markers first since runtime msgs never contain them.
    if (/compile error|syntax error|parse error/i.test(msg)) {
        return { ok: false, kind: 'jq_syntax_error', message: msg }
    }
    return { ok: false, kind: 'jq_runtime_error', message: msg }
}
