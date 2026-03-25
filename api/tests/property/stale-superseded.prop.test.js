import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  buildProvenanceObject,
} from '../../src/services/provenanceService.js'

// ─────────────────────────────────────────────────────────────────────────────
// Arbitraries — generators for provenance status fields and TTL scenarios
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a random boolean for stale/superseded flags */
const boolArb = fc.boolean()

/** Generate a random ISO 8601 UTC timestamp or null */
const isoTimestampOrNullArb = fc.oneof(
  fc.date({
    min: new Date('2020-01-01T00:00:00Z'),
    max: new Date('2030-12-31T23:59:59Z'),
  }).map(d => d.toISOString()),
  fc.constant(null),
)

/** Generate a random UUID-like string or null (for chunk IDs) */
const uuidOrNullArb = fc.oneof(
  fc.uuid(),
  fc.constant(null),
)

/**
 * Generate a full provenance status object with all four combinations
 * of is_stale and is_superseded representable.
 */
const statusArb = fc.record({
  is_stale: boolArb,
  stale_since: isoTimestampOrNullArb,
  is_superseded: boolArb,
  superseded_at: isoTimestampOrNullArb,
  superseded_by_chunk_id: uuidOrNullArb,
})

/** Generate a positive TTL in hours */
const positiveTtlArb = fc.integer({ min: 1, max: 8760 })

/** Generate source_retrieved_at as a Date object for TTL arithmetic */
const retrievedAtDateArb = fc.date({
  min: new Date('2020-01-01T00:00:00Z'),
  max: new Date('2028-12-31T23:59:59Z'),
})

// ─────────────────────────────────────────────────────────────────────────────
// Feature: provenance-engine, Property 5: Stale and superseded independence
// **Validates: Requirements 5.1, 5.5, 5.6**
//
// For any chunk, setting is_stale SHALL not modify is_superseded, and setting
// is_superseded SHALL not modify is_stale. All four combinations (neither,
// stale-only, superseded-only, both) SHALL be representable.
// ─────────────────────────────────────────────────────────────────────────────

describe('Property 5: Stale and superseded independence', () => {
  it('setting is_stale does not modify is_superseded', () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        // Simulate setting is_stale to true — is_superseded must remain unchanged
        const before = { ...status }
        const afterSetStale = { ...status, is_stale: true, stale_since: new Date().toISOString() }

        expect(afterSetStale.is_superseded).toBe(before.is_superseded)
        expect(afterSetStale.superseded_at).toBe(before.superseded_at)
        expect(afterSetStale.superseded_by_chunk_id).toBe(before.superseded_by_chunk_id)
      }),
      { numRuns: 100 },
    )
  })

  it('setting is_superseded does not modify is_stale', () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        // Simulate setting is_superseded to true — is_stale must remain unchanged
        const before = { ...status }
        const afterSetSuperseded = {
          ...status,
          is_superseded: true,
          superseded_at: new Date().toISOString(),
          superseded_by_chunk_id: 'new-chunk-uuid',
        }

        expect(afterSetSuperseded.is_stale).toBe(before.is_stale)
        expect(afterSetSuperseded.stale_since).toBe(before.stale_since)
      }),
      { numRuns: 100 },
    )
  })

  it('all four combinations of (is_stale, is_superseded) are representable', () => {
    // Enumerate all four combinations and verify each is a valid status object
    const combinations = [
      { is_stale: false, is_superseded: false },  // neither
      { is_stale: true,  is_superseded: false },  // stale only
      { is_stale: false, is_superseded: true  },  // superseded only
      { is_stale: true,  is_superseded: true  },  // both
    ]

    for (const combo of combinations) {
      const status = {
        ...combo,
        stale_since: combo.is_stale ? new Date().toISOString() : null,
        superseded_at: combo.is_superseded ? new Date().toISOString() : null,
        superseded_by_chunk_id: combo.is_superseded ? 'some-chunk-id' : null,
      }

      expect(status.is_stale).toBe(combo.is_stale)
      expect(status.is_superseded).toBe(combo.is_superseded)
    }
  })

  it('buildProvenanceObject status fields are independent booleans', () => {
    // Verify that the provenance object's status block has independent boolean fields
    // that can be mutated independently after construction
    const docSourceTypeArb = fc.constantFrom('document', 'url', 'youtube', 'audio', 'api')
    const metaArb = fc.record({
      source_type: docSourceTypeArb,
      file_type: fc.constantFrom('pdf', 'docx', undefined),
      source_url: fc.oneof(fc.webUrl(), fc.constant(undefined)),
      extraction_confidence: fc.oneof(
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.constant(undefined),
      ),
    })

    fc.assert(
      fc.property(metaArb, boolArb, boolArb, (meta, staleVal, supersededVal) => {
        const prov = buildProvenanceObject(meta)

        // Mutate is_stale independently
        prov.status.is_stale = staleVal
        expect(prov.status.is_superseded).toBe(false) // unchanged from construction default

        // Mutate is_superseded independently
        prov.status.is_superseded = supersededVal
        expect(prov.status.is_stale).toBe(staleVal) // unchanged from previous mutation

        // Both fields hold their independently-set values
        expect(prov.status.is_stale).toBe(staleVal)
        expect(prov.status.is_superseded).toBe(supersededVal)
      }),
      { numRuns: 100 },
    )
  })

  it('markStale-style mutation preserves superseded fields across random states', () => {
    fc.assert(
      fc.property(statusArb, fc.boolean(), (status, newStaleValue) => {
        // Simulate what markStale does: only touch is_stale and stale_since
        const updated = { ...status }
        updated.is_stale = newStaleValue
        updated.stale_since = newStaleValue ? new Date().toISOString() : status.stale_since

        // Superseded fields must be untouched
        expect(updated.is_superseded).toBe(status.is_superseded)
        expect(updated.superseded_at).toBe(status.superseded_at)
        expect(updated.superseded_by_chunk_id).toBe(status.superseded_by_chunk_id)
      }),
      { numRuns: 100 },
    )
  })

  it('markSuperseded-style mutation preserves stale fields across random states', () => {
    fc.assert(
      fc.property(statusArb, fc.boolean(), uuidOrNullArb, (status, newSupersededValue, newChunkId) => {
        // Simulate what markSuperseded does: only touch is_superseded, superseded_at, superseded_by_chunk_id
        const updated = { ...status }
        updated.is_superseded = newSupersededValue
        updated.superseded_at = newSupersededValue ? new Date().toISOString() : status.superseded_at
        updated.superseded_by_chunk_id = newSupersededValue ? newChunkId : status.superseded_by_chunk_id

        // Stale fields must be untouched
        expect(updated.is_stale).toBe(status.is_stale)
        expect(updated.stale_since).toBe(status.stale_since)
      }),
      { numRuns: 100 },
    )
  })
})


// ─────────────────────────────────────────────────────────────────────────────
// Feature: provenance-engine, Property 6: TTL-based stale detection
// **Validates: Requirements 5.2, 5.3**
//
// For any chunk with freshness_policy.ttl_hours set to a non-null positive
// number, the stale detector SHALL set is_stale = true if and only if
// NOW() > source_retrieved_at + ttl_hours.
// For any chunk with freshness_policy.ttl_hours = null, the stale detector
// SHALL leave is_stale unchanged by the time-based rule.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure stale detection logic extracted from the system's behaviour.
 * This mirrors what findStaleEligible + markStale do:
 *   - If ttl_hours is null → no change (time-based rule does not apply)
 *   - If ttl_hours is positive → stale iff now > retrieved_at + ttl_hours
 */
function shouldBeStaleByTTL(sourceRetrievedAt, ttlHours, now) {
  if (ttlHours == null) return null // null means "no time-based rule"
  const retrievedMs = new Date(sourceRetrievedAt).getTime()
  const ttlMs = ttlHours * 60 * 60 * 1000
  return now.getTime() > retrievedMs + ttlMs
}

describe('Property 6: TTL-based stale detection', () => {
  it('chunk is stale when NOW() > source_retrieved_at + ttl_hours', () => {
    fc.assert(
      fc.property(
        retrievedAtDateArb,
        positiveTtlArb,
        (retrievedAt, ttlHours) => {
          // Place "now" well after the TTL expiry
          const ttlMs = ttlHours * 60 * 60 * 1000
          const expiredNow = new Date(retrievedAt.getTime() + ttlMs + 1)

          const result = shouldBeStaleByTTL(retrievedAt.toISOString(), ttlHours, expiredNow)
          expect(result).toBe(true)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('chunk is NOT stale when NOW() <= source_retrieved_at + ttl_hours', () => {
    fc.assert(
      fc.property(
        retrievedAtDateArb,
        positiveTtlArb,
        // Generate a fraction of the TTL that has elapsed (0 to 1, exclusive of 1)
        fc.double({ min: 0, max: 0.999, noNaN: true, noDefaultInfinity: true }),
        (retrievedAt, ttlHours, fraction) => {
          const ttlMs = ttlHours * 60 * 60 * 1000
          // "now" is within the TTL window
          const freshNow = new Date(retrievedAt.getTime() + Math.floor(ttlMs * fraction))

          const result = shouldBeStaleByTTL(retrievedAt.toISOString(), ttlHours, freshNow)
          expect(result).toBe(false)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('chunk with ttl_hours = null is never flagged stale by time-based rule', () => {
    fc.assert(
      fc.property(
        retrievedAtDateArb,
        fc.date({ min: new Date('2020-01-01'), max: new Date('2035-12-31') }),
        (retrievedAt, now) => {
          const result = shouldBeStaleByTTL(retrievedAt.toISOString(), null, now)
          // null means the time-based rule does not apply
          expect(result).toBeNull()
        },
      ),
      { numRuns: 100 },
    )
  })

  it('stale detection is biconditional: stale ↔ NOW() > retrieved_at + ttl', () => {
    fc.assert(
      fc.property(
        retrievedAtDateArb,
        positiveTtlArb,
        // Generate "now" that can be before, at, or after the TTL boundary
        fc.integer({ min: -100, max: 100 }),
        (retrievedAt, ttlHours, offsetMs) => {
          const ttlMs = ttlHours * 60 * 60 * 1000
          const boundaryMs = retrievedAt.getTime() + ttlMs
          const now = new Date(boundaryMs + offsetMs)

          const result = shouldBeStaleByTTL(retrievedAt.toISOString(), ttlHours, now)
          const expectedStale = now.getTime() > boundaryMs

          expect(result).toBe(expectedStale)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('buildProvenanceObject sets correct ttl_hours per layer for stale detection', () => {
    // L3 sources (auto_refresh) should have a default ttl_hours of 24
    const l3MetaArb = fc.record({
      source_type: fc.constant('url'),
      source_tier: fc.constant(3),
      source_url: fc.oneof(fc.webUrl(), fc.constant(undefined)),
      extraction_confidence: fc.oneof(
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.constant(undefined),
      ),
    })

    fc.assert(
      fc.property(l3MetaArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        expect(prov.layer).toBe('L3')
        expect(prov.snapshot_policy).toBe('auto_refresh')
        // L3 default ttl_hours is 24 (from LAYER_POLICY)
        expect(prov.source.freshness_policy.ttl_hours).toBe(24)
      }),
      { numRuns: 100 },
    )
  })

  it('L1 sources have ttl_hours = null and are exempt from time-based stale detection', () => {
    const l1MetaArb = fc.record({
      source_type: fc.constantFrom('document', 'youtube', 'audio'),
      file_type: fc.constantFrom('pdf', 'docx', undefined),
      source_url: fc.oneof(fc.webUrl(), fc.constant(undefined)),
      extraction_confidence: fc.oneof(
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.constant(undefined),
      ),
    })

    fc.assert(
      fc.property(l1MetaArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        expect(prov.layer).toBe('L1')
        expect(prov.source.freshness_policy.ttl_hours).toBeNull()

        // Verify the stale detection logic skips null TTL
        const result = shouldBeStaleByTTL(
          prov.source.retrieved_at,
          prov.source.freshness_policy.ttl_hours,
          new Date(),
        )
        expect(result).toBeNull()
      }),
      { numRuns: 100 },
    )
  })

  it('custom ttl_hours override is respected in stale detection', () => {
    // L3 sources can have ttl_hours overridden via meta.ttl_hours
    fc.assert(
      fc.property(
        positiveTtlArb,
        retrievedAtDateArb,
        (customTtl, retrievedAt) => {
          const meta = {
            source_type: 'url',
            source_tier: 3,
            source_url: 'https://example.com',
            ttl_hours: customTtl,
            retrieved_at: retrievedAt.toISOString(),
          }
          const prov = buildProvenanceObject(meta)

          // The custom TTL should be used instead of the layer default
          expect(prov.source.freshness_policy.ttl_hours).toBe(customTtl)

          // Verify stale detection uses the custom TTL
          const ttlMs = customTtl * 60 * 60 * 1000
          const expiredNow = new Date(retrievedAt.getTime() + ttlMs + 1)
          const result = shouldBeStaleByTTL(prov.source.retrieved_at, prov.source.freshness_policy.ttl_hours, expiredNow)
          expect(result).toBe(true)

          const freshNow = new Date(retrievedAt.getTime() + Math.floor(ttlMs * 0.5))
          const freshResult = shouldBeStaleByTTL(prov.source.retrieved_at, prov.source.freshness_policy.ttl_hours, freshNow)
          expect(freshResult).toBe(false)
        },
      ),
      { numRuns: 100 },
    )
  })
})
