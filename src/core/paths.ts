import { resolve, sep } from 'node:path'
import type { ErrorEnvelope } from '../types.js'
import { makeError } from './errors.js'

export const isUnderRoot = (candidate: string, root: string): boolean => {
    const rp = resolve(candidate)
    const rr = resolve(root)
    return rp === rr || rp.startsWith(rr + sep)
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
        { field: fieldName, root, value: candidate },
    )
}
