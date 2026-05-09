import { describe, expect, it } from 'vitest'
import { classifyContentType, parseCharset } from '../../src/core/content_type.js'

describe('content_type', () => {
    it('classifies json', () => {
        expect(classifyContentType('application/json')).toBe('json')
        expect(classifyContentType('application/json; charset=utf-8')).toBe('json')
        expect(classifyContentType('application/vnd.api+json')).toBe('json')
        expect(classifyContentType('application/ld+json')).toBe('json')
    })

    it('classifies text', () => {
        expect(classifyContentType('text/html; charset=utf-8')).toBe('text')
        expect(classifyContentType('text/plain')).toBe('text')
        expect(classifyContentType('application/xml')).toBe('text')
        expect(classifyContentType('application/yaml')).toBe('text')
        expect(classifyContentType('application/javascript')).toBe('text')
    })

    it('classifies binary', () => {
        expect(classifyContentType('image/png')).toBe('binary')
        expect(classifyContentType('application/pdf')).toBe('binary')
        expect(classifyContentType('application/octet-stream')).toBe('binary')
        expect(classifyContentType('audio/mpeg')).toBe('binary')
    })

    it('treats missing or empty content-type as binary', () => {
        expect(classifyContentType('')).toBe('binary')
        expect(classifyContentType(undefined)).toBe('binary')
    })

    it('parses charset', () => {
        expect(parseCharset('application/json; charset=utf-8')).toBe('utf-8')
        expect(parseCharset('text/plain; charset=ISO-8859-1')).toBe('iso-8859-1')
        expect(parseCharset('text/plain')).toBeUndefined()
    })
})
