import { describe, it, expect } from 'vitest'
import { canonicalizeUrl } from '../../src/services/canonicalize.js'

describe('canonicalizeUrl', () => {
  it('lowercases scheme and host', () => {
    expect(canonicalizeUrl('HTTPS://Example.COM/path')).toBe('https://example.com/path')
  })

  it('removes trailing slash on non-root path', () => {
    expect(canonicalizeUrl('https://example.com/page/')).toBe('https://example.com/page')
  })

  it('preserves root URL as-is', () => {
    expect(canonicalizeUrl('https://example.com')).toBe('https://example.com')
  })

  it('removes utm_source tracking param', () => {
    expect(canonicalizeUrl('https://example.com/page?utm_source=twitter')).toBe('https://example.com/page')
  })

  it('removes multiple tracking params, preserves non-tracking', () => {
    expect(
      canonicalizeUrl('https://example.com/page?id=123&utm_medium=email&ref=foo&q=bar')
    ).toBe('https://example.com/page?id=123&q=bar')
  })

  it('strips fragments', () => {
    expect(canonicalizeUrl('https://example.com/page#section')).toBe('https://example.com/page')
  })

  it('removes all known tracking params', () => {
    const url = 'https://example.com/?utm_source=a&utm_medium=b&utm_campaign=c&utm_term=d&utm_content=e&ref=x&source=y&fbclid=z&gclid=w'
    expect(canonicalizeUrl(url)).toBe('https://example.com/')
  })

  it('throws on invalid URL', () => {
    expect(() => canonicalizeUrl('not-a-url')).toThrow()
  })
})
