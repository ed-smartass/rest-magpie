// `next_step_hints` are advisory jq masks suggested based on the top-level
// shape of a JSON body. The agent picks one or writes its own; the server
// does NOT execute them.
//
// Inference is intentionally simple: we look at the OUTER shape only. Going
// deeper would either repeat what the schema already shows or balloon into
// something approaching jq compilation.

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)

const isObjectArray = (v: unknown[]): boolean => v.length > 0 && v.every((x) => isPlainObject(x))

const objectKeys = (v: unknown): string[] => (isPlainObject(v) ? Object.keys(v) : [])

const arrayValuedFields = (obj: Record<string, unknown>): string[] => {
    const out: string[] = []
    for (const [k, v] of Object.entries(obj)) {
        if (Array.isArray(v)) out.push(k)
    }
    return out
}

const sample = <T>(arr: T[], n: number): T[] => arr.slice(0, n)

// jq treats unquoted path components like `.foo-bar` as an expression
// (`.foo MINUS .bar`). Object literals like `{foo-bar}` are syntax errors.
// Only keys matching this pattern are safe to interpolate raw.
const JQ_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const isJqIdent = (s: string): boolean => JQ_IDENT.test(s)

// Render `.<key>` safely — bracket-quoted form for non-identifier keys.
// jq accepts `."weird-key"`, `."2fa"`, etc. Escape backslash + double-quote
// for the JSON-style string literal, then strip the entire ASCII control
// range (and DEL) so no embedded \x00-\x1F or \x7F can break the parser.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping all controls is the point
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g
const dotKey = (k: string): string => {
    if (isJqIdent(k)) return '.' + k
    const escaped = k.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(CONTROL_CHARS, '')
    return '."' + escaped + '"'
}

export const inferNextStepHints = (parsed: unknown): string[] => {
    if (parsed === null || parsed === undefined) return []

    if (Array.isArray(parsed)) {
        if (parsed.length === 0) return ['length']
        if (isObjectArray(parsed)) {
            // Pick a couple of plausible keys for the projection examples.
            // Only identifier-safe keys go into shorthand `{k1, k2}` form;
            // others would be syntax errors there.
            const firstObj = parsed[0] as Record<string, unknown>
            const safeKeys = sample(Object.keys(firstObj).filter(isJqIdent), 2)
            const hints = ['length', '.[:5]']
            if (safeKeys.length >= 2) {
                hints.push('. | map({' + safeKeys.join(', ') + '})')
            } else if (safeKeys.length === 1) {
                hints.push('. | map({' + safeKeys[0] + '})')
            } else {
                hints.push('. | map(. | to_entries | map({key, type: (.value|type)}))')
            }
            hints.push('. | map(select(.id))') // generic filter pattern
            hints.push('. | sort_by(.created_at) | reverse | .[:10]')
            return hints
        }
        // Array of scalars
        return ['length', '.[:10]', '. | unique', '. | min', '. | max']
    }

    if (isPlainObject(parsed)) {
        const arrFields = arrayValuedFields(parsed)
        if (arrFields.length > 0) {
            const f = arrFields[0]!
            const fAccess = dotKey(f)
            const otherSafe = sample(
                Object.keys(parsed).filter((k) => k !== f && isJqIdent(k)),
                2,
            )
            const hints = [fAccess + ' | length', fAccess + '[:5]', fAccess + ' | map({id, name})']
            if (otherSafe.length > 0) {
                hints.push('. | { ' + otherSafe.join(', ') + ' }')
            }
            return hints
        }
        const keys = objectKeys(parsed)
        if (keys.length === 0) return ['keys']
        const projSafe = sample(keys.filter(isJqIdent), 2)
        const hints = ['keys', 'to_entries | map({key: .key, type: (.value|type)})']
        if (projSafe.length >= 2) {
            hints.push('. | { ' + projSafe.join(', ') + ' }')
        } else if (projSafe.length === 1) {
            hints.push('. | { ' + projSafe[0] + ' }')
        }
        return hints
    }

    return []
}
