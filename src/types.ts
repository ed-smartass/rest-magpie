// HTTP method.
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

// How a response body was classified.
export type BodyKind = 'json' | 'text' | 'binary' | 'empty'

// Schema format selectors.
export type SchemaFormat = 'paths' | 'shape' | 'sample' | 'json_schema'

// Body inclusion mode.
//   schema   → no body in response (just the rendered schema)
//   head     → schema + body_preview (truncated arrays/strings)
//   inline   → schema + body (full body, capped by PEEK_INLINE_BODY_CAP)
//   auto     → server picks based on byte thresholds (default)
export type BodyMode = 'auto' | 'schema' | 'head' | 'inline'

// Concrete mode after `auto` resolution. Reported on every response.
export type ResolvedBodyMode = 'schema' | 'head' | 'inline'

// jq multi-output collection mode.
export type JqOutputMode = 'first' | 'all'

// Multipart input shape.
export interface MultipartInput {
    fields?: Record<string, string>
    files?: Record<string, MultipartFile>
}
export type MultipartFile = MultipartFilePath | MultipartFileInline

export interface MultipartFilePath {
    path: string
    filename?: string
    content_type?: string
}

export interface MultipartFileInline {
    content_base64: string
    filename?: string
    content_type?: string
}

// http_request input. Field order matches spec Section 4.1.
export interface HttpRequestParams {
    method: HttpMethod
    url: string
    query?: Record<string, string | string[]>
    headers?: Record<string, string>
    body?: unknown
    body_raw?: string
    multipart?: MultipartInput
    content_type?: string
    timeout_ms?: number
    follow_redirects?: boolean
    tls_insecure?: boolean
    schema_format?: SchemaFormat
    body_mode?: BodyMode
    download_to?: string
}

export interface BodyInclusion {
    resolved_mode: ResolvedBodyMode
    inline_threshold_bytes: number
    head_preview_threshold_bytes: number
    head_preview_items: number
    head_preview_string_chars: number
    inline_body_cap_bytes: number
    reason?: string
}

export interface ResponseMeta {
    url: string
    method: HttpMethod
    duration_ms: number
    response_headers: Record<string, string>
    body_bytes: number
    content_type: string
    body_kind: BodyKind
    body_inclusion: BodyInclusion
    redirect_chain: string[]
    download_path?: string
}

// schema is string for paths/shape/sample, object for json_schema, descriptor for non-json.
export type Schema = string | NonJsonSchemaDescriptor | JsonSchemaObject

export interface NonJsonSchemaDescriptor {
    type: 'text' | 'binary' | 'empty'
    content_type?: string
    char_count?: number
    line_count?: number
    head?: string
    byte_count?: number
    sha256?: string
}

export type JsonSchemaObject = Record<string, unknown>

export interface HttpRequestResult {
    cache_id: string
    status: number
    meta: ResponseMeta
    schema: Schema
    next_step_hints?: string[]
    body_preview?: unknown
    body?: unknown
}

// http_read input.
export interface HttpReadParams {
    cache_id: string
    mask?: string
    output_mode?: JqOutputMode
    save_to?: string
}
export interface HttpReadResult {
    result: unknown
}

// http_inspect input.
export interface HttpInspectParams {
    cache_id: string
    schema_format: SchemaFormat
}
export interface HttpInspectResult {
    schema: Schema
    next_step_hints?: string[]
}

// Unified error envelope.
export type ErrorKind =
    | 'invalid_input'
    | 'invalid_url'
    | 'timeout'
    | 'network_error'
    | 'tls_error'
    | 'redirect_loop'
    | 'body_too_large'
    | 'body_too_large_for_inline'
    | 'unsupported_field'
    | 'cache_miss'
    | 'jq_syntax_error'
    | 'jq_runtime_error'
    | 'jq_timeout'
    | 'mask_not_applicable'
    | 'save_failed'

export interface ErrorEnvelope {
    error: { kind: ErrorKind; message: string; detail?: Record<string, unknown> }
}

export type Result<T> = T | ErrorEnvelope

// Cache entry (internal but used in tests).
export interface CacheEntry {
    cache_id: string
    created_at: number
    body_kind: BodyKind
    body: unknown | string | Buffer | null
    meta: ResponseMeta
    status: number
}
