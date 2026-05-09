import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { getConfig } from '../config.js'
import type { Cache } from '../core/cache.js'
import { makeError } from '../core/errors.js'
import { runJq } from '../core/jq.js'
import { ensureUnderRoot } from '../core/paths.js'
import type { HttpReadParams, HttpReadResult, Result } from '../types.js'

export const httpReadTool = async (
    params: HttpReadParams,
    cache: Cache,
): Promise<Result<HttpReadResult>> => {
    const entry = cache.get(params.cache_id)
    if (!entry) return makeError('cache_miss', 'unknown cache_id: ' + params.cache_id)

    if (params.save_to) {
        const err = ensureUnderRoot(params.save_to, getConfig().filesRoot, 'save_to')
        if (err) return err
    }

    if (entry.body_kind === 'binary') {
        if (params.mask)
            return makeError('mask_not_applicable', 'mask is only valid for JSON bodies')
        if (!params.save_to) {
            return makeError('invalid_input', 'binary body requires save_to to retrieve content')
        }
        // entry.body is null when the original http_request used download_to:
        // the bytes streamed straight to disk instead of being buffered in
        // memory, so there's nothing to write here. Surface this clearly
        // instead of crashing on a blind cast.
        if (!Buffer.isBuffer(entry.body)) {
            return makeError(
                'invalid_input',
                'binary body is not buffered for this cache entry (original request used download_to). ' +
                    'Refer to meta.download_path on the http_request response, or re-fetch without download_to.',
            )
        }
        const buf = entry.body
        try {
            await writeFile(params.save_to, buf)
        } catch (e) {
            return makeError('save_failed', e instanceof Error ? e.message : String(e))
        }
        return {
            result: {
                saved_to: params.save_to,
                byte_count: buf.length,
                sha256: createHash('sha256').update(buf).digest('hex'),
            },
        }
    }

    if (entry.body_kind === 'text') {
        if (params.mask)
            return makeError('mask_not_applicable', 'mask is only valid for JSON bodies')
        return { result: entry.body as string }
    }

    if (entry.body_kind === 'empty') {
        return { result: null }
    }

    // JSON path
    if (!params.mask) return { result: entry.body }
    const jq = await runJq(entry.body, params.mask, params.output_mode ?? 'all')
    if (!jq.ok) return makeError(jq.kind, jq.message)
    return { result: jq.value }
}
