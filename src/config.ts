import { resolve } from 'node:path'

export interface Config {
    defaultTimeoutMs: number
    maxResponseBytes: number
    cacheTtlSeconds: number
    inlineThresholdBytes: number
    headPreviewThresholdBytes: number
    headPreviewItems: number
    headPreviewStringChars: number
    inlineBodyCapBytes: number
    maxInlineFileBytes: number
    jqTimeoutMs: number
    useNativeJq: boolean
    tlsInsecure: boolean
    schemaMaxDepth: number
    schemaMaxObjectKeys: number
    schemaSampleMaxString: number
    filesRoot: string | undefined
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

const intEnv = (name: string, fallback: number): number => {
    const raw = process.env[name]
    if (raw === undefined) return fallback
    const n = Number(raw)
    return Number.isFinite(n) && Number.isInteger(n) ? n : fallback
}

const boolEnv = (name: string, fallback: boolean): boolean => {
    const raw = process.env[name]
    if (raw === undefined) return fallback
    return TRUTHY.has(raw.toLowerCase())
}

const pathEnv = (name: string): string | undefined => {
    const raw = process.env[name]
    if (raw === undefined) return undefined
    const trimmed = raw.trim()
    if (trimmed === '') return undefined
    return resolve(trimmed)
}

export const loadConfig = (): Config => {
    return {
        defaultTimeoutMs: intEnv('PEEK_DEFAULT_TIMEOUT_MS', 30000),
        maxResponseBytes: intEnv('PEEK_MAX_RESPONSE_BYTES', 50 * 1024 * 1024),
        cacheTtlSeconds: intEnv('PEEK_CACHE_TTL_SECONDS', 600),
        inlineThresholdBytes: intEnv('PEEK_INLINE_THRESHOLD_BYTES', 8192),
        headPreviewThresholdBytes: intEnv('PEEK_HEAD_PREVIEW_THRESHOLD', 64 * 1024),
        headPreviewItems: intEnv('PEEK_HEAD_PREVIEW_ITEMS', 5),
        headPreviewStringChars: intEnv('PEEK_HEAD_PREVIEW_STRING', 200),
        inlineBodyCapBytes: intEnv('PEEK_INLINE_BODY_CAP', 256 * 1024),
        maxInlineFileBytes: intEnv('PEEK_MAX_INLINE_FILE_BYTES', 10 * 1024 * 1024),
        jqTimeoutMs: intEnv('PEEK_JQ_TIMEOUT_MS', 5000),
        useNativeJq: boolEnv('PEEK_USE_NATIVE_JQ', false),
        tlsInsecure: boolEnv('PEEK_TLS_INSECURE', false),
        schemaMaxDepth: intEnv('PEEK_SCHEMA_MAX_DEPTH', 10),
        schemaMaxObjectKeys: intEnv('PEEK_SCHEMA_MAX_OBJECT_KEYS', 200),
        schemaSampleMaxString: intEnv('PEEK_SCHEMA_SAMPLE_MAX_STRING', 100),
        filesRoot: pathEnv('PEEK_FILES_ROOT'),
    }
}

// Lazily-initialized singleton; tests create fresh ones via loadConfig().
let cached: Config | undefined
export const getConfig = (): Config => {
    if (!cached) cached = loadConfig()
    return cached
}

// For tests: reset the singleton.
export const resetConfigCache = (): void => {
    cached = undefined
}
