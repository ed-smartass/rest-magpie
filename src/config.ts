import { resolve } from 'node:path'

export interface Config {
    defaultTimeoutMs: number
    maxResponseBytes: number
    cacheTtlSeconds: number
    autoIncludeBodyBytes: number
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
    if (raw === undefined || raw.trim() === '') return undefined
    return resolve(raw)
}

export const loadConfig = (): Config => {
    return {
        defaultTimeoutMs: intEnv('MAGPIE_DEFAULT_TIMEOUT_MS', 30000),
        maxResponseBytes: intEnv('MAGPIE_MAX_RESPONSE_BYTES', 50 * 1024 * 1024),
        cacheTtlSeconds: intEnv('MAGPIE_CACHE_TTL_SECONDS', 600),
        autoIncludeBodyBytes: intEnv('MAGPIE_AUTO_INCLUDE_BODY_BYTES', 8192),
        jqTimeoutMs: intEnv('MAGPIE_JQ_TIMEOUT_MS', 5000),
        useNativeJq: boolEnv('MAGPIE_USE_NATIVE_JQ', false),
        tlsInsecure: boolEnv('MAGPIE_TLS_INSECURE', false),
        schemaMaxDepth: intEnv('MAGPIE_SCHEMA_MAX_DEPTH', 10),
        schemaMaxObjectKeys: intEnv('MAGPIE_SCHEMA_MAX_OBJECT_KEYS', 200),
        schemaSampleMaxString: intEnv('MAGPIE_SCHEMA_SAMPLE_MAX_STRING', 100),
        filesRoot: pathEnv('MAGPIE_FILES_ROOT'),
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
