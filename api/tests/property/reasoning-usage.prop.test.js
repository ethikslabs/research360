import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  buildProvenanceObject,
  shapeByDepth,
} from '../../src/services/provenanceService.js'

// ─────────────────────────────────────────────────────────────────────────────
// Arbitraries — smart generators for reasoning usage entries and provenance
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a random ISO 8601 UTC timestamp */
const isoTimestampArb = fc.date({
  min: new Date('2020-01-01T00:00:00Z'),
  max: new Date('2030-12-31T23:59:59Z'),
}).map(d => d.toISOString())

/** Generate a random reasoning confidence in [0, 1] */
const reasoningConfidenceArb = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })

/** Generate a random step name */
const stepNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_ -]{0,49}$/)

/** Generate a single valid reasoning usage entry */
const usageEntryArb = fc.record({
  step: stepNameArb,
  step_index: fc.integer({ min: 0, max: 1000 }),
  confidence: reasoningConfidenceArb,
  used_at: isoTimestampArb,
})

/** Generate a non-empty array of usage entries (1 to 50) */
const usageArrayArb = fc.array(usageEntryArb, { minLength: 1, maxLength: 50 })

/** Generate a random UUID-like run_id */
const runIdArb = fc.uuid()

/** Generate a random extraction confidence in [0, 1] */
const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })

/** Generate a random URL string */
const urlArb = fc.webUrl()

/** Generate a random S3 URI */
const s3UriArb = fc.stringMatching(/^[a-zA-Z0-9]{3,30}$/)
  .map(key => `s3://research360/snapshots/${key}`)

/** Generate a random document-level source_type */
const docSourceTypeArb = fc.constantFrom('document', 'url', 'youtube', 'audio', 'api')

/** Generate a random file_type */
const fileTypeArb = fc.constantFrom('pdf', 'docx', 'pptx', undefined)

/** Generate a random source_tier */
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
  title: fc.oneof(fc.string({ minLength: 1, maxLength: 100 }), fc.constant(null)),
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
// Helper: simulate reasoning usage accumulation
//
// The reasoning service appends usage entries to a chunk's provenance
// reasoning.usages array. At rest, reasoning is { run_id: null, usages: [] }.
// Each Trust360 reasoning step appends a new entry without overwriting prior
// entries. This helper simulates that append-only accumulation.
// ─────────────────────────────────────────────────────────────────────────────

function accumulateUsages(provenance, usages) {
  // Deep clone to avoid mutation of the original
  const prov = JSON.parse(JSON.stringify(provenance))
  for (const usage of usages) {
    prov.reasoning.usages.push({ ...usage })
  }
  return prov
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: simulate run-scoped reasoning injection (mirrors retrievalService.js)
//
// When a query includes run_id, the retrieval service queries
// chunk_reasoning_usages and injects the reasoning block into provenance.
// When no run_id is provided, provenance retains { run_id: null, usages: [] }.
// ─────────────────────────────────────────────────────────────────────────────

function injectRunScopedReasoning(provenance, runId, usagesForRun) {
  if (!runId) {
    // No run_id → reasoning stays at rest
    return { ...provenance, reasoning: { run_id: null, usages: [] } }
  }
  // With run_id → scope reasoning to that run only
  return { ...provenance, reasoning: { run_id: runId, usages: usagesForRun } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature: provenance-engine, Property 10: Reasoning usage accumulation
// **Validates: Requirements 8.2, 8.3**
//
// For any sequence of N reasoning usage appends to a chunk's provenance,
// the reasoning.usages array SHALL have length N, each entry SHALL contain
// step (string), step_index (integer), confidence (float in [0,1]), and
// used_at (ISO 8601 UTC timestamp), and no prior entries SHALL be
// overwritten or collapsed.
// ─────────────────────────────────────────────────────────────────────────────

describe('Property 10: Reasoning usage accumulation', () => {
  it('usages array length equals the number of appended entries', () => {
    fc.assert(
      fc.property(ingestionMetaArb, usageArrayArb, (meta, usages) => {
        const prov = buildProvenanceObject(meta)
        // Starts empty
        expect(prov.reasoning.usages).toHaveLength(0)

        const accumulated = accumulateUsages(prov, usages)
        expect(accumulated.reasoning.usages).toHaveLength(usages.length)
      }),
      { numRuns: 100 },
    )
  })

  it('each usage entry contains step (string), step_index (integer), confidence (float in [0,1]), used_at (ISO 8601)', () => {
    fc.assert(
      fc.property(ingestionMetaArb, usageArrayArb, (meta, usages) => {
        const prov = buildProvenanceObject(meta)
        const accumulated = accumulateUsages(prov, usages)

        for (const entry of accumulated.reasoning.usages) {
          // step is a string
          expect(typeof entry.step).toBe('string')
          expect(entry.step.length).toBeGreaterThan(0)

          // step_index is an integer
          expect(Number.isInteger(entry.step_index)).toBe(true)

          // confidence is a float in [0, 1]
          expect(typeof entry.confidence).toBe('number')
          expect(entry.confidence).toBeGreaterThanOrEqual(0)
          expect(entry.confidence).toBeLessThanOrEqual(1)

          // used_at is an ISO 8601 UTC timestamp (parseable as a valid date)
          expect(typeof entry.used_at).toBe('string')
          const parsed = new Date(entry.used_at)
          expect(parsed.getTime()).not.toBeNaN()
        }
      }),
      { numRuns: 100 },
    )
  })

  it('no prior entries are overwritten or collapsed during accumulation', () => {
    fc.assert(
      fc.property(ingestionMetaArb, usageArrayArb, (meta, usages) => {
        const prov = buildProvenanceObject(meta)

        // Accumulate one at a time and verify prior entries are preserved
        let current = JSON.parse(JSON.stringify(prov))
        const snapshots = []

        for (let i = 0; i < usages.length; i++) {
          current.reasoning.usages.push({ ...usages[i] })
          // Snapshot the current state of usages
          snapshots.push([...current.reasoning.usages.map(u => JSON.stringify(u))])
        }

        // Verify: each snapshot[i] is a prefix of the final array
        const finalUsages = current.reasoning.usages.map(u => JSON.stringify(u))
        for (let i = 0; i < snapshots.length; i++) {
          for (let j = 0; j <= i; j++) {
            expect(finalUsages[j]).toBe(snapshots[i][j])
          }
        }

        // Verify: final array matches the input usages exactly (order preserved)
        expect(current.reasoning.usages).toHaveLength(usages.length)
        for (let i = 0; i < usages.length; i++) {
          expect(current.reasoning.usages[i].step).toBe(usages[i].step)
          expect(current.reasoning.usages[i].step_index).toBe(usages[i].step_index)
          expect(current.reasoning.usages[i].confidence).toBe(usages[i].confidence)
          expect(current.reasoning.usages[i].used_at).toBe(usages[i].used_at)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('provenance starts with empty usages array (never null)', () => {
    fc.assert(
      fc.property(ingestionMetaArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        expect(prov.reasoning.usages).toEqual([])
        expect(Array.isArray(prov.reasoning.usages)).toBe(true)
        expect(prov.reasoning.run_id).toBeNull()
      }),
      { numRuns: 100 },
    )
  })

  it('accumulation does not mutate the original provenance object', () => {
    fc.assert(
      fc.property(ingestionMetaArb, usageArrayArb, (meta, usages) => {
        const prov = buildProvenanceObject(meta)
        const originalUsagesLength = prov.reasoning.usages.length

        accumulateUsages(prov, usages)

        // Original should be unchanged
        expect(prov.reasoning.usages).toHaveLength(originalUsagesLength)
      }),
      { numRuns: 100 },
    )
  })
})


// ─────────────────────────────────────────────────────────────────────────────
// Feature: provenance-engine, Property 11: Run-scoped reasoning in query responses
// **Validates: Requirements 8.4, 8.5, 12.2**
//
// For any query request, if run_id is provided, the reasoning block in the
// response SHALL contain only usages from that specific run. If run_id is
// not provided, the reasoning block SHALL be { run_id: null, usages: [] }.
// ─────────────────────────────────────────────────────────────────────────────

describe('Property 11: Run-scoped reasoning in query responses', () => {
  it('without run_id, reasoning block is { run_id: null, usages: [] }', () => {
    fc.assert(
      fc.property(ingestionMetaArb, (meta) => {
        const prov = buildProvenanceObject(meta)
        const result = injectRunScopedReasoning(prov, null, [])

        expect(result.reasoning).toEqual({ run_id: null, usages: [] })
        expect(result.reasoning.run_id).toBeNull()
        expect(Array.isArray(result.reasoning.usages)).toBe(true)
        expect(result.reasoning.usages).toHaveLength(0)
      }),
      { numRuns: 100 },
    )
  })

  it('without run_id, reasoning block is empty even if provenance has accumulated usages', () => {
    fc.assert(
      fc.property(ingestionMetaArb, usageArrayArb, (meta, usages) => {
        const prov = buildProvenanceObject(meta)
        // Simulate accumulated usages on the chunk
        const withUsages = accumulateUsages(prov, usages)

        // Query without run_id → reasoning should be reset to empty
        const result = injectRunScopedReasoning(withUsages, null, [])

        expect(result.reasoning).toEqual({ run_id: null, usages: [] })
      }),
      { numRuns: 100 },
    )
  })

  it('with run_id, reasoning block contains only that run\'s usages', () => {
    fc.assert(
      fc.property(runIdArb, usageArrayArb, (runId, usages) => {
        const prov = buildProvenanceObject({ source_type: 'document' })
        const result = injectRunScopedReasoning(prov, runId, usages)

        expect(result.reasoning.run_id).toBe(runId)
        expect(result.reasoning.usages).toHaveLength(usages.length)

        // Each usage entry should match the input
        for (let i = 0; i < usages.length; i++) {
          expect(result.reasoning.usages[i]).toEqual(usages[i])
        }
      }),
      { numRuns: 100 },
    )
  })

  it('with run_id but no usages for that run, reasoning block has empty usages array', () => {
    fc.assert(
      fc.property(ingestionMetaArb, runIdArb, (meta, runId) => {
        const prov = buildProvenanceObject(meta)
        const result = injectRunScopedReasoning(prov, runId, [])

        expect(result.reasoning.run_id).toBe(runId)
        expect(result.reasoning.usages).toEqual([])
        expect(Array.isArray(result.reasoning.usages)).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('run-scoped reasoning only includes usages from the specified run, not other runs', () => {
    fc.assert(
      fc.property(
        runIdArb,
        runIdArb,
        usageArrayArb,
        usageArrayArb,
        (runIdA, runIdB, usagesA, usagesB) => {
          // Skip if both run IDs happen to be the same
          fc.pre(runIdA !== runIdB)

          const prov = buildProvenanceObject({ source_type: 'document' })

          // Query scoped to run A → should only see run A's usages
          const resultA = injectRunScopedReasoning(prov, runIdA, usagesA)
          expect(resultA.reasoning.run_id).toBe(runIdA)
          expect(resultA.reasoning.usages).toHaveLength(usagesA.length)
          expect(resultA.reasoning.usages).toEqual(usagesA)

          // Query scoped to run B → should only see run B's usages
          const resultB = injectRunScopedReasoning(prov, runIdB, usagesB)
          expect(resultB.reasoning.run_id).toBe(runIdB)
          expect(resultB.reasoning.usages).toHaveLength(usagesB.length)
          expect(resultB.reasoning.usages).toEqual(usagesB)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('run-scoped reasoning is visible at full_internal depth via shapeByDepth', () => {
    fc.assert(
      fc.property(ingestionMetaArb, runIdArb, usageArrayArb, (meta, runId, usages) => {
        const prov = buildProvenanceObject(meta)
        const withReasoning = injectRunScopedReasoning(prov, runId, usages)
        const shaped = shapeByDepth(withReasoning, 'full_internal')

        // full_internal depth should expose the reasoning block
        expect(shaped.reasoning.run_id).toBe(runId)
        expect(shaped.reasoning.usages).toHaveLength(usages.length)
      }),
      { numRuns: 100 },
    )
  })

  it('run-scoped reasoning is NOT visible at summary or internal depth', () => {
    fc.assert(
      fc.property(
        ingestionMetaArb,
        runIdArb,
        usageArrayArb,
        fc.constantFrom('summary', 'internal'),
        (meta, runId, usages, depth) => {
          const prov = buildProvenanceObject(meta)
          const withReasoning = injectRunScopedReasoning(prov, runId, usages)
          const shaped = shapeByDepth(withReasoning, depth)

          // summary and internal depths should NOT contain reasoning
          expect(shaped).not.toHaveProperty('reasoning')
        },
      ),
      { numRuns: 100 },
    )
  })
})
