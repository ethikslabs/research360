import { describe, it, expect } from 'vitest'
import { validateManifest } from '../../src/services/manifest-validator.js'

const VALID_CANDIDATE = {
  url: 'https://www.cyber.gov.au/resources',
  source_type: 'url',
  source_tier: 1,
  source_domain: 'cyber.gov.au',
  jurisdiction: 'AU',
  framework_tags: ['essential-eight'],
  vendor_tags: [],
  discovery_mode: 'gap_detection',
  justification: 'Adds Essential Eight guidance missing from corpus',
  confidence: 0.92,
}

describe('validateManifest', () => {
  it('accepts a valid candidate array', () => {
    const result = validateManifest(JSON.stringify([VALID_CANDIDATE]))
    expect(result.ok).toBe(true)
    expect(result.candidates).toHaveLength(1)
  })

  it('rejects non-array JSON', () => {
    const result = validateManifest(JSON.stringify({ url: 'https://example.com' }))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/array/)
  })

  it('rejects invalid JSON', () => {
    const result = validateManifest('not json {{{')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/JSON/)
  })

  it('rejects candidate missing required field', () => {
    const bad = { ...VALID_CANDIDATE }
    delete bad.justification
    const result = validateManifest(JSON.stringify([bad]))
    expect(result.ok).toBe(true)
    expect(result.candidates).toHaveLength(0)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].reason).toMatch(/justification/)
  })

  it('rejects confidence out of range', () => {
    const bad = { ...VALID_CANDIDATE, confidence: 1.5 }
    const result = validateManifest(JSON.stringify([bad]))
    expect(result.candidates).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/confidence/)
  })

  it('rejects invalid jurisdiction', () => {
    const bad = { ...VALID_CANDIDATE, jurisdiction: 'NZ' }
    const result = validateManifest(JSON.stringify([bad]))
    expect(result.candidates).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/jurisdiction/)
  })

  it('rejects invalid source_tier', () => {
    const bad = { ...VALID_CANDIDATE, source_tier: 5 }
    const result = validateManifest(JSON.stringify([bad]))
    expect(result.candidates).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/source_tier/)
  })

  it('rejects invalid discovery_mode', () => {
    const bad = { ...VALID_CANDIDATE, discovery_mode: 'random' }
    const result = validateManifest(JSON.stringify([bad]))
    expect(result.candidates).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/discovery_mode/)
  })

  it('rejects invalid URL', () => {
    const bad = { ...VALID_CANDIDATE, url: 'not-a-url' }
    const result = validateManifest(JSON.stringify([bad]))
    expect(result.candidates).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/url/)
  })

  it('rejects invalid source_type', () => {
    const bad = { ...VALID_CANDIDATE, source_type: 'rss' }
    const result = validateManifest(JSON.stringify([bad]))
    expect(result.candidates).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/source_type/)
  })

  it('accepts multiple candidates, rejects bad ones individually', () => {
    const bad = { ...VALID_CANDIDATE, confidence: -1 }
    const result = validateManifest(JSON.stringify([VALID_CANDIDATE, bad]))
    expect(result.candidates).toHaveLength(1)
    expect(result.rejected).toHaveLength(1)
  })
})
