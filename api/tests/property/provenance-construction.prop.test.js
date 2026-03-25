import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  buildProvenanceObject,
  buildChunkRow,
  resolveSourceClass,
  LAYER_POLICY,
} from '../../src/services/provenanceService.js'

// ─────────────────────────────────────────────────────────────────────────────
// Arbitraries — smart generators constrained to the valid input space
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a random valid document-level source_type (as seen in the documents table) */
const docSourceTypeArb = fc.constantFrom('document', 'url', 'youtube', 'audio', 'api')

/** Generate a random file_type */
const fileTypeArb = fc.constantFrom('pdf', 'docx', 'pptx', undefined)

/** Generate a random source_tier for discovery-sourced URLs */
const sourceTierArb = fc.constantFrom(1, 2, 3, undefined)

/** Generate a random extraction confidence in [0, 1] */
const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })

/** Generate a random extraction method */
const extractionMethodArb = fc.constantFrom('unstructured_io', 'playwright', 'whisper', 'api_response', 'pdf_parse')

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

/**
 * Generate a full valid ingestion metadata object covering all source types and layers.
 * This is the primary arbitrary for property tests.
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


// ─────────────────────────────────────────────────────────────────────────────
// Feature: provenance-engine, Property 1: Provenance object construction validity
// **Validates: Requirements 2.1, 2.5, 2.7, 2.8, 8.1**
//
// For any valid ingestion metadata, buildProvenanceObject SHALL produce:
// - schema_version "1.0"
// - extraction.confidence in [0, 1]
// - reasoning = { run_id: null, usages: [] }
// - status = { is_stale: false, stale_since: null, is_superseded: false,
//              superseded_at: null, superseded_by_chunk_id: null }
// ─────────────────────────────────────────────────────────────────────────────

describe('Property 1: Provenance object construction validity', () => {
  it('schema_version is always "1.0"', () => {
    fc.assert(
      fc.property(ingestionMetaArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        expect(prov.schema_version).toBe('1.0')
      }),
      { numRuns: 100 },
    )
  })

  it('extraction.confidence is always in [0, 1]', () => {
    fc.assert(
      fc.property(ingestionMetaArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        expect(prov.extraction.confidence).toBeGreaterThanOrEqual(0)
        expect(prov.extraction.confidence).toBeLessThanOrEqual(1)
      }),
      { numRuns: 100 },
    )
  })

  it('reasoning is always { run_id: null, usages: [] }', () => {
    fc.assert(
      fc.property(ingestionMetaArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        expect(prov.reasoning).toEqual({ run_id: null, usages: [] })
        expect(Array.isArray(prov.reasoning.usages)).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('status is always the initial state at construction', () => {
    fc.assert(
      fc.property(ingestionMetaArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        expect(prov.status).toEqual({
          is_stale: false,
          stale_since: null,
          is_superseded: false,
          superseded_at: null,
          superseded_by_chunk_id: null,
        })
      }),
      { numRuns: 100 },
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Feature: provenance-engine, Property 3: Provenance column/JSONB consistency
// at write (drift prevention)
// **Validates: Requirements 2.2, 4.1, 7.1**
//
// For any provenance written via buildChunkRow, top-level indexed columns
// SHALL equal corresponding JSONB values.
// ─────────────────────────────────────────────────────────────────────────────

describe('Property 3: Provenance column/JSONB consistency at write (drift prevention)', () => {
  it('all indexed columns match their JSONB counterparts', () => {
    fc.assert(
      fc.property(ingestionMetaArb, (meta) => {
        const row = buildChunkRow(meta)
        const prov = row.provenance

        expect(row.source_type).toBe(prov.source_type)
        expect(row.source_subtype).toBe(prov.source_subtype)
        expect(row.extraction_confidence).toBe(prov.extraction.confidence)
        expect(row.snapshot_policy).toBe(prov.snapshot_policy)
        expect(row.is_stale).toBe(prov.status.is_stale)
        expect(row.is_superseded).toBe(prov.status.is_superseded)
        expect(row.source_retrieved_at).toBe(prov.source.retrieved_at)
        expect(row.source_uri).toBe(prov.source.uri)
        expect(row.canonical_uri).toBe(prov.source.canonical_uri)
        expect(row.raw_snapshot_uri).toBe(prov.source.raw_snapshot_uri)
        expect(row.ingested_by).toBe(prov.extraction.ingested_by)
      }),
      { numRuns: 100 },
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Feature: provenance-engine, Property 4: Layer-to-policy mapping
// **Validates: Requirements 4.2, 4.3, 4.4, 4.5**
//
// L1 → {static, {ttl_hours: null, stale_if_fetch_fails: false}}
// L2 → {refresh_on_request, ...}
// L3 → {auto_refresh, {stale_if_fetch_fails: true}}
// L5 → {auto_refresh, {stale_if_fetch_fails: true}}
// ─────────────────────────────────────────────────────────────────────────────

describe('Property 4: Layer-to-policy mapping', () => {
  it('snapshot_policy and stale_if_fetch_fails match the layer rules', () => {
    fc.assert(
      fc.property(ingestionMetaArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        const layer = prov.layer
        const policy = LAYER_POLICY[layer]

        // snapshot_policy must match the layer's defined policy
        expect(prov.snapshot_policy).toBe(policy.snapshot_policy)

        // stale_if_fetch_fails must match the layer's defined value
        expect(prov.source.freshness_policy.stale_if_fetch_fails).toBe(policy.stale_if_fetch_fails)

        // Verify specific layer rules
        if (layer === 'L1') {
          expect(prov.snapshot_policy).toBe('static')
          expect(prov.source.freshness_policy.stale_if_fetch_fails).toBe(false)
        } else if (layer === 'L2') {
          expect(prov.snapshot_policy).toBe('refresh_on_request')
        } else if (layer === 'L3') {
          expect(prov.snapshot_policy).toBe('auto_refresh')
          expect(prov.source.freshness_policy.stale_if_fetch_fails).toBe(true)
        } else if (layer === 'L5') {
          expect(prov.snapshot_policy).toBe('auto_refresh')
          expect(prov.source.freshness_policy.stale_if_fetch_fails).toBe(true)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('L1 ttl_hours defaults to null when not overridden', () => {
    // Generate only L1 sources (direct uploads without company/session scope)
    const l1MetaArb = fc.record({
      source_type: fc.constantFrom('document', 'youtube', 'audio'),
      file_type: fc.constantFrom('pdf', 'docx', undefined),
      source_url: fc.oneof(urlArb, fc.constant(undefined)),
      extraction_confidence: fc.oneof(confidenceArb, fc.constant(undefined)),
      raw_snapshot_uri: fc.oneof(s3UriArb, fc.constant(null)),
    })

    fc.assert(
      fc.property(l1MetaArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        expect(prov.layer).toBe('L1')
        expect(prov.source.freshness_policy.ttl_hours).toBeNull()
      }),
      { numRuns: 100 },
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Feature: provenance-engine, Property 21: L1/L3/L5 raw snapshot URI presence
// **Validates: Requirements 2.9**
//
// For L1/L3/L5 sources with raw_snapshot_uri provided, it SHALL be
// non-null non-empty.
// ─────────────────────────────────────────────────────────────────────────────

describe('Property 21: L1/L3/L5 raw snapshot URI presence', () => {
  it('when raw_snapshot_uri is provided for L1/L3/L5, it is non-null non-empty in provenance', () => {
    // Generate L1 sources with a snapshot URI
    const l1WithSnapshotArb = fc.record({
      source_type: fc.constantFrom('document', 'youtube', 'audio'),
      file_type: fc.constantFrom('pdf', 'docx', undefined),
      source_url: fc.oneof(urlArb, fc.constant(undefined)),
      extraction_confidence: fc.oneof(confidenceArb, fc.constant(undefined)),
      raw_snapshot_uri: s3UriArb,
    })

    fc.assert(
      fc.property(l1WithSnapshotArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        expect(prov.layer).toBe('L1')
        expect(prov.source.raw_snapshot_uri).not.toBeNull()
        expect(prov.source.raw_snapshot_uri.length).toBeGreaterThan(0)
      }),
      { numRuns: 100 },
    )
  })

  it('when raw_snapshot_uri is provided for L3, it is non-null non-empty in provenance', () => {
    // Generate L3 sources (url with tier 3) with a snapshot URI
    const l3WithSnapshotArb = fc.record({
      source_type: fc.constant('url'),
      source_tier: fc.constant(3),
      source_url: fc.oneof(urlArb, fc.constant(undefined)),
      extraction_confidence: fc.oneof(confidenceArb, fc.constant(undefined)),
      raw_snapshot_uri: s3UriArb,
    })

    fc.assert(
      fc.property(l3WithSnapshotArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        expect(prov.layer).toBe('L3')
        expect(prov.source.raw_snapshot_uri).not.toBeNull()
        expect(prov.source.raw_snapshot_uri.length).toBeGreaterThan(0)
      }),
      { numRuns: 100 },
    )
  })

  it('when raw_snapshot_uri is provided for L5, it is non-null non-empty in provenance', () => {
    // Generate L5 sources (api) with a snapshot URI
    const l5WithSnapshotArb = fc.record({
      source_type: fc.constant('api'),
      file_type: fc.constantFrom('json_api', 'xml_api', undefined),
      source_url: fc.oneof(urlArb, fc.constant(undefined)),
      extraction_confidence: fc.oneof(confidenceArb, fc.constant(undefined)),
      raw_snapshot_uri: s3UriArb,
    })

    fc.assert(
      fc.property(l5WithSnapshotArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        expect(prov.layer).toBe('L5')
        expect(prov.source.raw_snapshot_uri).not.toBeNull()
        expect(prov.source.raw_snapshot_uri.length).toBeGreaterThan(0)
      }),
      { numRuns: 100 },
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Feature: provenance-engine, Property 2: Source taxonomy validation
// **Validates: Requirements 2.3, 2.4, 2.6, 3.1, 3.2, 3.3**
//
// For any string pair (source_type, source_subtype), validateSourceTaxonomy
// SHALL return valid: true if and only if source_type is in
// {file, web, api, audio} AND source_subtype is in the valid set for that
// source_type. For all other string pairs, it SHALL return valid: false
// with an error message.
// ─────────────────────────────────────────────────────────────────────────────

import { validateSourceTaxonomy } from '../../src/services/provenanceService.js'

/** The complete valid taxonomy: each source_type maps to its allowed subtypes */
const VALID_TAXONOMY = {
  file:  ['pdf', 'docx'],
  web:   ['html', 'rss'],
  api:   ['json_api', 'xml_api'],
  audio: ['podcast', 'youtube'],
}

const ALL_VALID_TYPES = Object.keys(VALID_TAXONOMY)
const ALL_VALID_SUBTYPES = Object.values(VALID_TAXONOMY).flat()

/** Arbitrary that produces a valid (source_type, source_subtype) pair */
const validPairArb = fc.constantFrom(
  ...ALL_VALID_TYPES.flatMap(type =>
    VALID_TAXONOMY[type].map(subtype => [type, subtype])
  ),
)

/** Arbitrary that produces a random string NOT in a given set */
const stringNotIn = (excluded) =>
  fc.string({ minLength: 1, maxLength: 30 })
    .filter(s => !excluded.includes(s))

/** Arbitrary that produces an invalid source_type (not in the valid set) */
const invalidTypeArb = stringNotIn(ALL_VALID_TYPES)

/** Arbitrary that produces a mismatched pair: valid type but wrong subtype for that type */
const mismatchedPairArb = fc.constantFrom(...ALL_VALID_TYPES).chain(type => {
  const validForType = VALID_TAXONOMY[type]
  // Pick a subtype that is valid globally but NOT for this specific type
  const otherSubtypes = ALL_VALID_SUBTYPES.filter(s => !validForType.includes(s))
  return fc.constantFrom(...otherSubtypes).map(subtype => [type, subtype])
})

describe('Property 2: Source taxonomy validation', () => {
  it('returns valid: true for all valid (source_type, source_subtype) pairs', () => {
    fc.assert(
      fc.property(validPairArb, ([type, subtype]) => {
        const result = validateSourceTaxonomy(type, subtype)
        expect(result).toEqual({ valid: true })
      }),
      { numRuns: 100 },
    )
  })

  it('returns valid: false with error for invalid source_type', () => {
    fc.assert(
      fc.property(
        invalidTypeArb,
        fc.string({ minLength: 0, maxLength: 30 }),
        (type, subtype) => {
          const result = validateSourceTaxonomy(type, subtype)
          expect(result.valid).toBe(false)
          expect(typeof result.error).toBe('string')
          expect(result.error.length).toBeGreaterThan(0)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('returns valid: false with error for valid source_type but mismatched source_subtype', () => {
    fc.assert(
      fc.property(mismatchedPairArb, ([type, subtype]) => {
        const result = validateSourceTaxonomy(type, subtype)
        expect(result.valid).toBe(false)
        expect(typeof result.error).toBe('string')
        expect(result.error.length).toBeGreaterThan(0)
      }),
      { numRuns: 100 },
    )
  })

  it('returns valid: false for valid source_type with completely invalid source_subtype', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_VALID_TYPES),
        stringNotIn(ALL_VALID_SUBTYPES),
        (type, subtype) => {
          const result = validateSourceTaxonomy(type, subtype)
          expect(result.valid).toBe(false)
          expect(typeof result.error).toBe('string')
          expect(result.error.length).toBeGreaterThan(0)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('valid: true ↔ type ∈ {file,web,api,audio} AND subtype matches parent type', () => {
    // Biconditional: generate arbitrary strings and verify the classification
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 30 }),
        fc.string({ minLength: 0, maxLength: 30 }),
        (type, subtype) => {
          const result = validateSourceTaxonomy(type, subtype)
          const isValidType = ALL_VALID_TYPES.includes(type)
          const isValidSubtypeForType = isValidType && VALID_TAXONOMY[type].includes(subtype)

          if (isValidSubtypeForType) {
            expect(result).toEqual({ valid: true })
          } else {
            expect(result.valid).toBe(false)
            expect(typeof result.error).toBe('string')
            expect(result.error.length).toBeGreaterThan(0)
          }
        },
      ),
      { numRuns: 200 },
    )
  })
})
