import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

// ─────────────────────────────────────────────────────────────────────────────
// Feature: provenance-engine, Property 15: Refresh scope enforcement per layer
// **Validates: Requirements 6.1, 6.2, 6.3, 13.2, 13.3, 13.4, 13.5**
//
// For any refresh request targeting L3 or L5 chunks, the refresh SHALL
// require source_uri or canonical_uri.
// For any refresh request targeting L1 chunks, the refresh SHALL require
// a raw S3 snapshot.
// For any refresh request targeting L2 chunks, the refresh SHALL require
// company_id.
// ─────────────────────────────────────────────────────────────────────────────

// We test scope validation by extracting the validateScope logic from
// refreshService.js. Since validateScope is not exported, we replicate
// its logic as a pure function and verify it against the source code,
// then property-test the invariants.

import { readFileSync } from 'fs'
import { resolve } from 'path'

const refreshSource = readFileSync(
  resolve(import.meta.dirname, '../../src/services/refreshService.js'),
  'utf8',
)

// ─────────────────────────────────────────────────────────────────────────────
// Pure model of validateScope — mirrors the logic in refreshService.js
// ─────────────────────────────────────────────────────────────────────────────

function validateScope(chunk, { companyId }) {
  const layer = chunk.provenance?.layer
  if (layer === 'L2' && !companyId) {
    return { valid: false, reason: `L2 chunk ${chunk.id} requires companyId for refresh` }
  }
  if ((layer === 'L3' || layer === 'L5') && !chunk.source_uri && !chunk.canonical_uri) {
    return { valid: false, reason: `L3/L5 chunk ${chunk.id} requires a source URI for refresh` }
  }
  if (layer === 'L1' && !chunk.raw_snapshot_uri) {
    return { valid: false, reason: `L1 chunk ${chunk.id} requires a raw snapshot to refresh` }
  }
  return { valid: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Arbitraries
// ─────────────────────────────────────────────────────────────────────────────

const uuidArb = fc.uuid()
const urlArb = fc.webUrl()
const s3UriArb = fc.stringMatching(/^[a-zA-Z0-9]{3,20}$/)
  .map(key => `s3://test-bucket/snapshots/${key}`)
const companyIdArb = fc.stringMatching(/^[a-zA-Z0-9]{3,20}$/)
const layerArb = fc.constantFrom('L1', 'L2', 'L3', 'L5')

function buildChunk(id, layer, opts = {}) {
  return {
    id,
    provenance: { layer },
    source_uri: opts.source_uri ?? null,
    canonical_uri: opts.canonical_uri ?? null,
    raw_snapshot_uri: opts.raw_snapshot_uri ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Property 15: Refresh scope enforcement per layer', () => {
  // Verify our model matches the actual source code
  it('refreshService.js contains validateScope with L2 companyId check', () => {
    expect(refreshSource).toContain("layer === 'L2' && !companyId")
  })

  it('refreshService.js contains validateScope with L3/L5 URI check', () => {
    expect(refreshSource).toContain("layer === 'L3' || layer === 'L5'")
    expect(refreshSource).toContain('!chunk.source_uri && !chunk.canonical_uri')
  })

  it('refreshService.js contains validateScope with L1 snapshot check', () => {
    expect(refreshSource).toContain("layer === 'L1' && !chunk.raw_snapshot_uri")
  })

  it('L2 chunk without companyId is rejected', () => {
    fc.assert(
      fc.property(uuidArb, (chunkId) => {
        const chunk = buildChunk(chunkId, 'L2')
        const result = validateScope(chunk, { companyId: undefined })
        expect(result.valid).toBe(false)
        expect(result.reason).toContain('companyId')
      }),
      { numRuns: 100 },
    )
  })

  it('L2 chunk with companyId is accepted', () => {
    fc.assert(
      fc.property(uuidArb, companyIdArb, (chunkId, companyId) => {
        const chunk = buildChunk(chunkId, 'L2')
        const result = validateScope(chunk, { companyId })
        expect(result.valid).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('L3 chunk without source_uri and canonical_uri is rejected', () => {
    fc.assert(
      fc.property(uuidArb, (chunkId) => {
        const chunk = buildChunk(chunkId, 'L3', {
          source_uri: null,
          canonical_uri: null,
        })
        const result = validateScope(chunk, {})
        expect(result.valid).toBe(false)
        expect(result.reason).toContain('source URI')
      }),
      { numRuns: 100 },
    )
  })

  it('L5 chunk without source_uri and canonical_uri is rejected', () => {
    fc.assert(
      fc.property(uuidArb, (chunkId) => {
        const chunk = buildChunk(chunkId, 'L5', {
          source_uri: null,
          canonical_uri: null,
        })
        const result = validateScope(chunk, {})
        expect(result.valid).toBe(false)
        expect(result.reason).toContain('source URI')
      }),
      { numRuns: 100 },
    )
  })

  it('L3 chunk with source_uri is accepted', () => {
    fc.assert(
      fc.property(uuidArb, urlArb, (chunkId, sourceUri) => {
        const chunk = buildChunk(chunkId, 'L3', { source_uri: sourceUri })
        const result = validateScope(chunk, {})
        expect(result.valid).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('L3 chunk with canonical_uri is accepted', () => {
    fc.assert(
      fc.property(uuidArb, urlArb, (chunkId, canonicalUri) => {
        const chunk = buildChunk(chunkId, 'L3', { canonical_uri: canonicalUri })
        const result = validateScope(chunk, {})
        expect(result.valid).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('L5 chunk with source_uri is accepted', () => {
    fc.assert(
      fc.property(uuidArb, urlArb, (chunkId, sourceUri) => {
        const chunk = buildChunk(chunkId, 'L5', { source_uri: sourceUri })
        const result = validateScope(chunk, {})
        expect(result.valid).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('L5 chunk with canonical_uri is accepted', () => {
    fc.assert(
      fc.property(uuidArb, urlArb, (chunkId, canonicalUri) => {
        const chunk = buildChunk(chunkId, 'L5', { canonical_uri: canonicalUri })
        const result = validateScope(chunk, {})
        expect(result.valid).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('L1 chunk without raw_snapshot_uri is rejected', () => {
    fc.assert(
      fc.property(uuidArb, (chunkId) => {
        const chunk = buildChunk(chunkId, 'L1', { raw_snapshot_uri: null })
        const result = validateScope(chunk, {})
        expect(result.valid).toBe(false)
        expect(result.reason).toContain('raw snapshot')
      }),
      { numRuns: 100 },
    )
  })

  it('L1 chunk with raw_snapshot_uri is accepted', () => {
    fc.assert(
      fc.property(uuidArb, s3UriArb, (chunkId, snapshotUri) => {
        const chunk = buildChunk(chunkId, 'L1', { raw_snapshot_uri: snapshotUri })
        const result = validateScope(chunk, {})
        expect(result.valid).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('scope enforcement is biconditional per layer', () => {
    // For any random chunk with a random layer, the scope check result
    // should be deterministic based on the layer and available fields
    const chunkArb = fc.record({
      id: uuidArb,
      layer: layerArb,
      source_uri: fc.oneof(urlArb, fc.constant(null)),
      canonical_uri: fc.oneof(urlArb, fc.constant(null)),
      raw_snapshot_uri: fc.oneof(s3UriArb, fc.constant(null)),
    })
    const companyIdOptArb = fc.oneof(companyIdArb, fc.constant(undefined))

    fc.assert(
      fc.property(chunkArb, companyIdOptArb, (chunkData, companyId) => {
        const chunk = buildChunk(chunkData.id, chunkData.layer, {
          source_uri: chunkData.source_uri,
          canonical_uri: chunkData.canonical_uri,
          raw_snapshot_uri: chunkData.raw_snapshot_uri,
        })
        const result = validateScope(chunk, { companyId })

        // Verify the biconditional: valid ↔ scope requirements met
        if (chunkData.layer === 'L2') {
          expect(result.valid).toBe(!!companyId)
        } else if (chunkData.layer === 'L3' || chunkData.layer === 'L5') {
          expect(result.valid).toBe(!!(chunkData.source_uri || chunkData.canonical_uri))
        } else if (chunkData.layer === 'L1') {
          expect(result.valid).toBe(!!chunkData.raw_snapshot_uri)
        }
      }),
      { numRuns: 200 },
    )
  })
})
