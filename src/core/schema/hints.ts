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

export const inferNextStepHints = (parsed: unknown): string[] => {
    if (parsed === null || parsed === undefined) return []

    if (Array.isArray(parsed)) {
        if (parsed.length === 0) return ['length']
        if (isObjectArray(parsed)) {
            // Pick a couple of plausible keys for the projection examples.
            const firstObj = parsed[0] as Record<string, unknown>
            const keys = sample(Object.keys(firstObj), 2)
            const projection =
                keys.length >= 2
                    ? '. | map({' + keys.join(', ') + '})'
                    : keys.length === 1
                      ? '. | map({' + keys[0] + '})'
                      : '. | map(.)'
            return [
                'length',
                '.[:5]',
                projection,
                '. | map(select(.id))', // generic filter pattern
                '. | sort_by(.created_at) | reverse | .[:10]',
            ]
        }
        // Array of scalars
        return ['length', '.[:10]', '. | unique', '. | min', '. | max']
    }

    if (isPlainObject(parsed)) {
        const arrFields = arrayValuedFields(parsed)
        if (arrFields.length > 0) {
            const f = arrFields[0]!
            const otherKeys = sample(
                Object.keys(parsed).filter((k) => k !== f),
                2,
            )
            const hints = ['.' + f + ' | length', '.' + f + '[:5]', '.' + f + ' | map({id, name})']
            if (otherKeys.length > 0) hints.push('. | { ' + otherKeys.join(', ') + ' }')
            return hints
        }
        const keys = objectKeys(parsed)
        if (keys.length === 0) return ['keys']
        const projKeys = sample(keys, 2)
        return [
            'keys',
            'to_entries | map({key: .key, type: (.value|type)})',
            projKeys.length >= 2
                ? '. | { ' + projKeys.join(', ') + ' }'
                : '. | { ' + projKeys[0] + ' }',
        ]
    }

    return []
}
