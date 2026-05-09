import { existsSync } from 'node:fs'
import { getConfig } from '../config.js'

export interface ServerInfoResult {
    version: string
    runtime: 'npx' | 'docker' | 'unknown'
    cwd: string
    files_root: string | null
    effective_limits: {
        inline_threshold_bytes: number
        head_preview_threshold_bytes: number
        head_preview_items: number
        head_preview_string_chars: number
        inline_body_cap_bytes: number
        max_response_bytes: number
        cache_ttl_seconds: number
        jq_timeout_ms: number
        default_timeout_ms: number
        max_inline_file_bytes: number
        schema_max_depth: number
        schema_max_object_keys: number
        schema_sample_max_string: number
        tls_insecure: boolean
        use_native_jq: boolean
    }
}

const detectRuntime = (): 'npx' | 'docker' | 'unknown' => {
    if (existsSync('/.dockerenv')) return 'docker'
    // npx and direct npm install both run a node process whose argv[1] is
    // the bin shim; treat both as "npx" for server_info purposes since the
    // distinction doesn't change anything an agent would care about.
    const argv1 = process.argv[1] ?? ''
    if (argv1.includes('rest-magpie') || argv1.includes('npm')) return 'npx'
    return 'unknown'
}

export const serverInfoTool = (version: string): ServerInfoResult => {
    const cfg = getConfig()
    return {
        version,
        runtime: detectRuntime(),
        cwd: process.cwd(),
        files_root: cfg.filesRoot ?? null,
        effective_limits: {
            inline_threshold_bytes: cfg.inlineThresholdBytes,
            head_preview_threshold_bytes: cfg.headPreviewThresholdBytes,
            head_preview_items: cfg.headPreviewItems,
            head_preview_string_chars: cfg.headPreviewStringChars,
            inline_body_cap_bytes: cfg.inlineBodyCapBytes,
            max_response_bytes: cfg.maxResponseBytes,
            cache_ttl_seconds: cfg.cacheTtlSeconds,
            jq_timeout_ms: cfg.jqTimeoutMs,
            default_timeout_ms: cfg.defaultTimeoutMs,
            max_inline_file_bytes: cfg.maxInlineFileBytes,
            schema_max_depth: cfg.schemaMaxDepth,
            schema_max_object_keys: cfg.schemaMaxObjectKeys,
            schema_sample_max_string: cfg.schemaSampleMaxString,
            tls_insecure: cfg.tlsInsecure,
            use_native_jq: cfg.useNativeJq,
        },
    }
}
