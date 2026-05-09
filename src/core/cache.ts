import { randomBytes } from 'node:crypto'
import type { CacheEntry } from '../types.js'

interface Slot {
    entry: CacheEntry
    timer: NodeJS.Timeout
}

export class Cache {
    private store = new Map<string, Slot>()

    constructor(private readonly ttlSeconds: number) {}

    // Cryptographically random ID. cache_ids cross between http_request
    // (server-side) and http_read (agent-supplied), so guessability is a
    // soft confidentiality concern — guessing a live cache_id leaks the
    // body of someone else's response within the same process.
    newId(): string {
        return 'req_' + randomBytes(16).toString('hex')
    }

    put(entry: CacheEntry): void {
        this.delete(entry.cache_id) // replace if exists
        const timer = setTimeout(() => this.delete(entry.cache_id), this.ttlSeconds * 1000)
        if (typeof timer.unref === 'function') timer.unref()
        this.store.set(entry.cache_id, { entry, timer })
    }

    get(cache_id: string): CacheEntry | undefined {
        return this.store.get(cache_id)?.entry
    }

    delete(cache_id: string): void {
        const slot = this.store.get(cache_id)
        if (!slot) return
        clearTimeout(slot.timer)
        this.store.delete(cache_id)
    }

    size(): number {
        return this.store.size
    }
}
