import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { ErrorEnvelope } from '../types.js'
import { makeError } from './errors.js'

export const isUnderRoot = (candidate: string, root: string): boolean => {
    const rp = resolve(candidate)
    const rr = resolve(root)
    return rp === rr || rp.startsWith(rr + sep)
}

// Detect whether the server is running inside a Docker container.
// /.dockerenv is the canonical marker; cheap and safe to stat per call but
// cached anyway because runtime doesn't change mid-process.
let cachedRuntime: 'docker' | 'host' | undefined
const detectRuntime = (): 'docker' | 'host' => {
    if (cachedRuntime) return cachedRuntime
    cachedRuntime = existsSync('/.dockerenv') ? 'docker' : 'host'
    return cachedRuntime
}

// Test-only hook to override the cached runtime detection.
// Pass undefined to force re-detection on next call.
export const __setRuntimeForTests = (runtime: 'docker' | 'host' | undefined) => {
    cachedRuntime = runtime
}

const buildHint = (root: string): string => {
    if (detectRuntime() === 'docker') {
        return (
            'Path must resolve inside the container under ' +
            root +
            '. With the recommended same-path bind mount, the host path and the container path are identical, ' +
            'so passing the host path verbatim works. See README → "Run modes & file paths".'
        )
    }
    return 'Path must canonicalise to a location under ' + root + ' (resolved via path.resolve).'
}

export const ensureUnderRoot = (
    candidate: string,
    root: string | undefined,
    fieldName: string,
): ErrorEnvelope | null => {
    if (root === undefined) return null
    if (isUnderRoot(candidate, root)) return null
    return makeError(
        'invalid_input',
        fieldName + ' must be under MAGPIE_FILES_ROOT (' + root + ')',
        {
            field: fieldName,
            value: candidate,
            resolved: resolve(candidate),
            root,
            runtime: detectRuntime(),
            hint: buildHint(root),
        },
    )
}
