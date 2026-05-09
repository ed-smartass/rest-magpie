import type { CacheEntry } from '../types.js'

interface Slot {
    entry: CacheEntry
    timer: NodeJS.Timeout
}

export class Cache {
    private store = new Map<string, Slot>()

    constructor(private readonly ttlSeconds: number) {}

    newId(): string {
        const ts = Date.now().toString(36)
        const rand = Math.random().toString(36).slice(2, 10)
        return 'req_' + ts + rand
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
