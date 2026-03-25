import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  shapeByDepth,
  mapConfidenceBand,
  buildProvenanceObject,
} from '../../src/services/provenanceService.js'

// ─────────────────────────────────────────────────────────────────────────────
// Arbitraries — smart generators for provenance objects and confidence values
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a random extraction confidence in [0, 1] */
const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })

/** Generate a random ISO 8601 UTC timestamp */
const isoTimestampArb = fc.date({
  min: new Date('2020-01-01T00:00:00Z'),
  max: new Date('2030-12-31T23:59:59Z'),
}).map(d => d.toISOString())

/** Generate a random URL string */
const urlArb = fc.webUrl()

/** Generate a random S3 URI */
const s3UriArb = fc.stringMatching(/^[a-zA-Z0-9]{3,30}$/)
  .map(key => `s3://research360/snapshots/${key}`)

/** Generate a random title or null */
const titleArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 100 }),
  fc.constant(null),
)

/** Generate a random document-level source_type */
const docSourceTypeArb = fc.constantFrom('document', 'url', 'youtube', 'audio', 'api')

/** Generate a random file_type */
const fileTypeArb = fc.constantFrom('pdf', 'docx', 'pptx', undefined)

/** Generate a random source_tier for discovery-sourced URLs */
const sourceTierArb = fc.constantFrom(1, 2, 3, undefined)

/** Generate a random extraction method */
const extractionMethodArb = fc.constantFrom('unstructured_io', 'playwright', 'whisper', 'api_response', 'pdf_parse')

/**
 * Generate a full valid ingestion metadata object.
 * Used to produce realistic provenance objects via buildProvenanceObject.
 */
const ingestionMetaArb = fc.record({
  source_type: docSourceTypeArb,
  file_type: fileTypeArb,
  source_tier: sourceTierArb,
  source_url: fc.oneof(urlArb, fc.constant(undefined)),
  canonical_uri: fc.oneof(urlArb, fc.constant(undefined)),
  raw_snapshot_uri: fc.oneof(s3UriArb, fc.constant(null)),
  title: titleArb,
  version: fc.oneof(fc.string({ minLength: 1, maxLength: 10 }), fc.constant(null)),
  extraction_confidence: fc.oneof(confidenceArb, fc.constant(undefined)),
  extraction_method: fc.oneof(extractionMethodArb, fc.constant(undefined)),
  ingested_at: fc.oneof(isoTimestampArb, fc.constant(undefined)),
  ingested_by: fc.oneof(fc.constant('ingestion-bot-v1'), fc.constant(undefined)),
  retrieved_at: fc.oneof(isoTimestampArb, fc.constant(undefined)),
  ttl_hours: fc.oneof(fc.integer({ min: 1, max: 8760 }), fc.constant(null), fc.constant(undefined)),
  company_id: fc.oneof(fc.string({ minLength: 1, maxLength: 20 }), fc.constant(undefined)),
  session_id: fc.oneof(fc.string({ minLength: 1, maxLength: 20 }), fc.constant(undefined)),
})

/** Generate a provenance_depth value */
const depthArb = fc.constantFrom('summary', 'internal', 'full_internal')

// Fields that must NOT appear at summary or internal depth
const FORBIDDEN_AT_SUMMARY_AND_INTERNAL = ['layer', 'reasoning']

// ─────────────────────────────────────────────────────────────────────────────
// Feature: provenance-engine, Property 12: Depth-based response shaping
// **Validates: Requirements 9.1, 9.2, 9.3, 9.5, 12.1**
//
// For any full provenance object and any provenance_depth in
// {summary, internal, full_internal}, shapeByDepth SHALL return an object
// containing exactly the allowlisted fields for that depth and no others.
// summary SHALL NOT contain layer, chunk_id, extraction.ingested_by,
// raw_snapshot_uri, or reasoning.
// internal SHALL NOT contain layer, chunk_id, extraction.ingested_by,
// raw_snapshot_uri, or reasoning.
// full_internal SHALL contain all fields.
// ─────────────────────────────────────────────────────────────────────────────

describe('Property 12: Depth-based response shaping', () => {
  it('summary depth contains only the allowlisted fields', () => {
    fc.assert(
      fc.property(ingestionMetaArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        const shaped = shapeByDepth(prov, 'summary')

        // Must have these top-level keys and no others
        const topKeys = Object.keys(shaped).sort()
        expect(topKeys).toEqual(['extraction', 'schema_version', 'source', 'status'].sort())

        // extraction must only have confidence_band
        expect(Object.keys(shaped.extraction).sort()).toEqual(['confidence_band'])

        // source must only have title, uri, retrieved_at
        expect(Object.keys(shaped.source).sort()).toEqual(['retrieved_at', 'title', 'uri'].sort())

        // status must only have is_stale, is_superseded
        expect(Object.keys(shaped.status).sort()).toEqual(['is_stale', 'is_superseded'].sort())

        // Forbidden fields must not appear
        expect(shaped).not.toHaveProperty('layer')
        expect(shaped).not.toHaveProperty('reasoning')
        expect(shaped.extraction).not.toHaveProperty('ingested_by')
        expect(shaped.source).not.toHaveProperty('raw_snapshot_uri')
      }),
      { numRuns: 100 },
    )
  })

  it('internal depth contains summary fields plus taxonomy, canonical_uri, method, full status, snapshot_policy', () => {
    fc.assert(
      fc.property(ingestionMetaArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        const shaped = shapeByDepth(prov, 'internal')

        // Must have these top-level keys
        const topKeys = Object.keys(shaped).sort()
        expect(topKeys).toEqual([
          'extraction', 'schema_version', 'snapshot_policy',
          'source', 'source_subtype', 'source_type', 'status',
        ].sort())

        // extraction must have confidence_band, confidence, method, ingested_at (no ingested_by)
        expect(Object.keys(shaped.extraction).sort()).toEqual(
          ['confidence', 'confidence_band', 'ingested_at', 'method'].sort()
        )

        // source must have title, uri, retrieved_at, canonical_uri, version, freshness_policy
        expect(Object.keys(shaped.source).sort()).toEqual(
          ['canonical_uri', 'freshness_policy', 'retrieved_at', 'title', 'uri', 'version'].sort()
        )

        // Forbidden fields must not appear at internal depth
        expect(shaped).not.toHaveProperty('layer')
        expect(shaped).not.toHaveProperty('reasoning')
        expect(shaped.extraction).not.toHaveProperty('ingested_by')
        expect(shaped.source).not.toHaveProperty('raw_snapshot_uri')
      }),
      { numRuns: 100 },
    )
  })

  it('full_internal depth contains all fields including layer, ingested_by, raw_snapshot_uri, reasoning', () => {
    fc.assert(
      fc.property(ingestionMetaArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        const shaped = shapeByDepth(prov, 'full_internal')

        // Must have layer and reasoning at top level
        expect(shaped).toHaveProperty('layer')
        expect(shaped).toHaveProperty('reasoning')

        // extraction must include ingested_by
        expect(shaped.extraction).toHaveProperty('ingested_by')

        // source must include raw_snapshot_uri
        expect(shaped.source).toHaveProperty('raw_snapshot_uri')

        // reasoning must have run_id and usages
        expect(shaped.reasoning).toHaveProperty('run_id')
        expect(shaped.reasoning).toHaveProperty('usages')
        expect(Array.isArray(shaped.reasoning.usages)).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('summary and internal never leak forbidden fields for any random provenance', () => {
    fc.assert(
      fc.property(ingestionMetaArb, depthArb, (meta, depth) => {
        const prov = buildProvenanceObject(meta)
        const shaped = shapeByDepth(prov, depth)

        if (depth === 'summary' || depth === 'internal') {
          // These fields must never appear at summary or internal depth
          expect(shaped).not.toHaveProperty('layer')
          expect(shaped).not.toHaveProperty('reasoning')
          expect(shaped.extraction).not.toHaveProperty('ingested_by')
          expect(shaped.source).not.toHaveProperty('raw_snapshot_uri')
        }
      }),
      { numRuns: 100 },
    )
  })

  it('full_internal is a superset of internal fields', () => {
    fc.assert(
      fc.property(ingestionMetaArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        const internal = shapeByDepth(prov, 'internal')
        const full = shapeByDepth(prov, 'full_internal')

        // All internal top-level keys must exist in full_internal
        for (const key of Object.keys(internal)) {
          expect(full).toHaveProperty(key)
        }

        // full_internal must have additional keys not in internal
        expect(full).toHaveProperty('layer')
        expect(full).toHaveProperty('reasoning')
      }),
      { numRuns: 100 },
    )
  })

  it('shapeByDepth returns null for null provenance input', () => {
    const result = shapeByDepth(null, 'summary')
    expect(result).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Feature: provenance-engine, Property 13: Confidence band mapping
// **Validates: Requirements 10.1, 10.2, 10.3**
//
// For any float value c in [0, 1], mapConfidenceBand(c) SHALL return
// "Strong" if c >= 0.90, "Moderate" if 0.70 <= c < 0.90,
// and "Check original" if c < 0.70.
// ─────────────────────────────────────────────────────────────────────────────

describe('Property 13: Confidence band mapping', () => {
  it('maps any confidence in [0, 1] to the correct band', () => {
    fc.assert(
      fc.property(confidenceArb, (c) => {
        const band = mapConfidenceBand(c)
        if (c >= 0.90) {
          expect(band).toBe('Strong')
        } else if (c >= 0.70) {
          expect(band).toBe('Moderate')
        } else {
          expect(band).toBe('Check original')
        }
      }),
      { numRuns: 100 },
    )
  })

  it('boundary: exactly 0.90 maps to Strong', () => {
    expect(mapConfidenceBand(0.90)).toBe('Strong')
  })

  it('boundary: exactly 0.70 maps to Moderate', () => {
    expect(mapConfidenceBand(0.70)).toBe('Moderate')
  })

  it('boundary: just below 0.70 maps to Check original', () => {
    // Use values very close to but below 0.70
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.6999999999, noNaN: true, noDefaultInfinity: true }),
        (c) => {
          expect(mapConfidenceBand(c)).toBe('Check original')
        },
      ),
      { numRuns: 100 },
    )
  })

  it('boundary: just below 0.90 maps to Moderate', () => {
    // Use values in [0.70, 0.8999999999]
    fc.assert(
      fc.property(
        fc.double({ min: 0.70, max: 0.8999999999, noNaN: true, noDefaultInfinity: true }),
        (c) => {
          expect(mapConfidenceBand(c)).toBe('Moderate')
        },
      ),
      { numRuns: 100 },
    )
  })

  it('null or undefined confidence maps to Check original', () => {
    expect(mapConfidenceBand(null)).toBe('Check original')
    expect(mapConfidenceBand(undefined)).toBe('Check original')
  })

  it('confidence band in shaped summary always matches the raw confidence', () => {
    fc.assert(
      fc.property(ingestionMetaArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        const shaped = shapeByDepth(prov, 'summary')
        const expectedBand = mapConfidenceBand(prov.extraction.confidence)
        expect(shaped.extraction.confidence_band).toBe(expectedBand)
      }),
      { numRuns: 100 },
    )
  })
})
