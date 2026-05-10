import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setRuntimeForTests, ensureUnderRoot, isUnderRoot } from '../../src/core/paths.js'

describe('isUnderRoot', () => {
    it('returns true when path equals root', () => {
        expect(isUnderRoot('/data/uploads', '/data/uploads')).toBe(true)
    })

    it('returns true for direct children', () => {
        expect(isUnderRoot('/data/uploads/photo.jpg', '/data/uploads')).toBe(true)
    })

    it('returns true for nested descendants', () => {
        expect(isUnderRoot('/data/uploads/sub/dir/file', '/data/uploads')).toBe(true)
    })

    it('returns false for paths above root', () => {
        expect(isUnderRoot('/data', '/data/uploads')).toBe(false)
    })

    it('returns false for siblings starting with root prefix', () => {
        expect(isUnderRoot('/data/uploadsx/file', '/data/uploads')).toBe(false)
    })

    it('canonicalizes traversal — rejects /root/../escape', () => {
        expect(isUnderRoot('/data/uploads/../../etc/passwd', '/data/uploads')).toBe(false)
    })

    it('canonicalizes redundant separators', () => {
        expect(isUnderRoot('/data//uploads/./photo.jpg', '/data/uploads')).toBe(true)
    })

    it('handles trailing slashes on root', () => {
        expect(isUnderRoot('/data/uploads/photo.jpg', '/data/uploads/')).toBe(true)
    })

    it('rejects relative paths against absolute root', () => {
        // resolve() turns 'photo.jpg' into cwd/photo.jpg, which is unlikely to be under root.
        expect(isUnderRoot('photo.jpg', '/data/uploads')).toBe(false)
    })

    it('handles root="/" without the "//" prefix bug', () => {
        // With the old `rr + sep` logic, root='/' became '//' and rejected
        // every absolute path. Everything is under '/' so accept all.
        expect(isUnderRoot('/etc/passwd', '/')).toBe(true)
        expect(isUnderRoot('/home/user/file', '/')).toBe(true)
        expect(isUnderRoot('/', '/')).toBe(true)
    })

    it('rejects non-existent path inside symlinked-out parent (FILES_ROOT bypass)', () => {
        // Set up: <root>/escape -> <outside>. Then candidate = <root>/escape/new.txt
        // which doesn't yet exist. The lexical-fallback canonicalize would have
        // accepted it (string starts with root), letting a write land outside.
        const tmp = mkdtempSync(join(tmpdir(), 'magpie-paths-'))
        const root = join(tmp, 'root')
        const outside = join(tmp, 'outside')
        mkdirSync(root)
        mkdirSync(outside)
        symlinkSync(outside, join(root, 'escape'))
        const candidate = join(root, 'escape', 'new.txt') // does NOT exist
        expect(isUnderRoot(candidate, root)).toBe(false)
    })

    it('accepts non-existent path inside genuinely-under-root parent', () => {
        // Counterpart sanity check: the new logic must still allow legitimate
        // download_to / save_to targets that don't yet exist.
        const tmp = mkdtempSync(join(tmpdir(), 'magpie-paths-'))
        const root = join(tmp, 'root')
        mkdirSync(root)
        mkdirSync(join(root, 'sub'))
        const candidate = join(root, 'sub', 'will-create-this.bin')
        expect(isUnderRoot(candidate, root)).toBe(true)
    })
})

describe('ensureUnderRoot', () => {
    beforeEach(() => __setRuntimeForTests('host'))
    afterEach(() => __setRuntimeForTests(undefined))

    it('returns null when filesRoot is undefined (feature disabled)', () => {
        expect(ensureUnderRoot('/anywhere', undefined, 'path')).toBeNull()
    })

    it('returns null when path is under root', () => {
        expect(ensureUnderRoot('/data/uploads/photo.jpg', '/data/uploads', 'path')).toBeNull()
    })

    it('returns an error envelope when path is outside root', () => {
        const r = ensureUnderRoot('/etc/passwd', '/data/uploads', 'path')
        expect(r).not.toBeNull()
        expect(r?.error.kind).toBe('invalid_input')
        expect(r?.error.message).toContain('/data/uploads')
        expect(r?.error.message).toContain('path')
    })

    it('uses the field name in the error message', () => {
        const r = ensureUnderRoot('/etc/passwd', '/data/uploads', 'download_to')
        expect(r?.error.message).toContain('download_to')
    })

    it('exposes field, value, resolved, root, runtime, hint in detail', () => {
        const r = ensureUnderRoot('/etc/passwd/../escape', '/data/uploads', 'download_to')
        expect(r?.error.detail).toMatchObject({
            field: 'download_to',
            value: '/etc/passwd/../escape',
            resolved: '/etc/escape',
            root: '/data/uploads',
            runtime: 'host',
        })
        expect(r?.error.detail?.hint).toEqual(expect.any(String))
    })

    it('emits a host-flavoured hint when runtime=host', () => {
        const r = ensureUnderRoot('/etc/passwd', '/data/uploads', 'path')
        const hint = r?.error.detail?.hint as string
        expect(hint).toContain('canonicalise')
        expect(hint).toContain('/data/uploads')
        expect(hint).not.toContain('container')
    })

    it('emits a docker-flavoured hint when runtime=docker', () => {
        __setRuntimeForTests('docker')
        const r = ensureUnderRoot('/host/photo.jpg', '/data/uploads', 'multipart.files.foo.path')
        const hint = r?.error.detail?.hint as string
        expect(hint).toContain('container')
        expect(hint).toContain('same-path bind mount')
        expect(r?.error.detail?.runtime).toBe('docker')
    })
})
