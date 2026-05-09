import { existsSync, realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { ErrorEnvelope } from '../types.js'
import { makeError } from './errors.js'

// Resolve a path through symlinks where possible. If the path doesn't exist
// (common: a download_to target that hasn't been created yet), fall back to
// lexical resolve. This matters for security: a symlink pointing outside
// MAGPIE_FILES_ROOT could otherwise sneak past a lexical-only check.
const canonicalize = (p: string): string => {
    try {
        return realpathSync(p)
    } catch {
        return resolve(p)
    }
}

export const isUnderRoot = (candidate: string, root: string): boolean => {
    const rp = canonicalize(candidate)
    const rr = canonicalize(root)
    if (rp === rr) return true
    // root='/' or root canonicalising to a single sep means rr+sep would
    // become '//', which prefix-matches everything-incorrectly. Anything
    // is under '/', so short-circuit.
    if (rr === sep) return true
    return rp.startsWith(rr + sep)
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
    return (
        'Path must canonicalise to a location under ' +
        root +
        ' (resolved via realpath/path.resolve).'
    )
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
            resolved: canonicalize(candidate),
            root,
            runtime: detectRuntime(),
            hint: buildHint(root),
        },
    )
}
