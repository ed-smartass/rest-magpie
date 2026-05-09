import type { ErrorEnvelope, ErrorKind, Result } from '../types.js'

export const makeError = (
    kind: ErrorKind,
    message: string,
    detail?: Record<string, unknown>,
): ErrorEnvelope => {
    return { error: { kind, message, ...(detail ? { detail } : {}) } }
}

export const isError = <T>(value: Result<T> | unknown): value is ErrorEnvelope => {
    return (
        typeof value === 'object' &&
        value !== null &&
        'error' in value &&
        typeof (value as { error: unknown }).error === 'object'
    )
}
