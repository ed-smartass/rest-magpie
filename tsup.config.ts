import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsup'

const pkgPath = fileURLToPath(new URL('./package.json', import.meta.url))
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node20',
    outDir: 'dist',
    clean: true,
    sourcemap: true,
    splitting: false,
    shims: false,
    banner: { js: '#!/usr/bin/env node' },
    // Inline the version at build time so the published bundle can never
    // drift from package.json. Source code refers to __PEEK_VERSION__;
    // tests use process.env.npm_package_version (set by npm).
    define: {
        __PEEK_VERSION__: JSON.stringify(pkg.version),
    },
})
