import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the pool before importing the module under test
const mockQuery = vi.fn()
vi.mock('../../src/db/client.js', () => ({
  pool: { query: (...args) => mockQuery(...args) },
}))

const { insertRun, findRunById, findRunProvenance } = await import(
  '../../src/db/queries/trustRuns.js'
)

describe('trustRuns query module', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  // ── Module exports ────────────────────────────────────────────────────
  it('exports exactly insertRun, findRunById, findRunProvenance — no update/delete', async () => {
    const mod = await import('../../src/db/queries/trustRuns.js')
    const exportedNames = Object.keys(mod).sort()
    expect(exportedNames).toEqual(
      ['findRunById', 'findRunProvenance', 'insertRun'].sort()
    )
  })

  // ── insertRun ─────────────────────────────────────────────────────────
  describe('insertRun', () => {
    it('inserts a run and returns the created row', async () => {
      const fakeRow = {
        run_id: '00000000-0000-0000-0000-000000000001',
        company_id: 'acme',
        run_at: '2026-03-14T09:00:00Z',
      }
      mockQuery.mockResolvedValueOnce({ rows: [fakeRow] })

      const result = await insertRun({
        company_id: 'acme',
        corpus_snapshot: { docs: [1] },
        chunks_retrieved: ['chunk-a'],
        reasoning_steps: [{ step: 'analyse' }],
        gaps_identified: [],
        vendor_resolutions: null,
        trust_scores: { overall: 0.85 },
      })

      expect(result).toEqual(fakeRow)

      // Verify the SQL is an INSERT … RETURNING *
      const sql = mockQuery.mock.calls[0][0]
      expect(sql).toMatch(/INSERT INTO trust_runs/i)
      expect(sql).toMatch(/RETURNING \*/i)
      expect(sql).not.toMatch(/UPDATE/i)
      expect(sql).not.toMatch(/DELETE/i)
    })

    it('handles null/undefined optional fields gracefully', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ run_id: 'uuid', company_id: null }],
      })

      const result = await insertRun({})
      expect(result).toBeDefined()

      // All 7 params should be passed (company_id + 6 JSONB columns)
      const params = mockQuery.mock.calls[0][1]
      expect(params).toHaveLength(7)
      // company_id defaults to null
      expect(params[0]).toBeNull()
    })
  })

  // ── findRunById ───────────────────────────────────────────────────────
  describe('findRunById', () => {
    it('returns the run when found', async () => {
      const fakeRow = { run_id: 'abc', company_id: 'acme' }
      mockQuery.mockResolvedValueOnce({ rows: [fakeRow] })

      const result = await findRunById('abc')
      expect(result).toEqual(fakeRow)
      expect(mockQuery.mock.calls[0][1]).toEqual(['abc'])
    })

    it('returns null when run does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const result = await findRunById('nonexistent')
      expect(result).toBeNull()
    })
  })

  // ── findRunProvenance ─────────────────────────────────────────────────
  describe('findRunProvenance', () => {
    it('returns null when run does not exist', async () => {
      // findRunById query returns empty
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const result = await findRunProvenance('missing')
      expect(result).toBeNull()
    })

    it('returns provenance with sources when chunks_retrieved is an array', async () => {
      const fakeRun = {
        run_id: 'run-1',
        run_at: '2026-03-14T09:00:00Z',
        chunks_retrieved: ['chunk-a', 'chunk-b'],
      }
      const fakeSources = [
        { chunk_id: 'chunk-a', chunk_text: 'text a', provenance: {} },
        { chunk_id: 'chunk-b', chunk_text: 'text b', provenance: {} },
      ]

      // First call: findRunById
      mockQuery.mockResolvedValueOnce({ rows: [fakeRun] })
      // Second call: chunk provenance lookup
      mockQuery.mockResolvedValueOnce({ rows: fakeSources })

      const result = await findRunProvenance('run-1')
      expect(result).toEqual({
        run_id: 'run-1',
        run_at: '2026-03-14T09:00:00Z',
        sources: fakeSources,
      })
    })

    it('returns provenance with sources when chunks_retrieved is an object (keyed by chunk id)', async () => {
      const fakeRun = {
        run_id: 'run-2',
        run_at: '2026-03-14T10:00:00Z',
        chunks_retrieved: { 'chunk-x': { score: 0.9 }, 'chunk-y': { score: 0.8 } },
      }
      const fakeSources = [
        { chunk_id: 'chunk-x', chunk_text: 'x', provenance: {} },
      ]

      mockQuery.mockResolvedValueOnce({ rows: [fakeRun] })
      mockQuery.mockResolvedValueOnce({ rows: fakeSources })

      const result = await findRunProvenance('run-2')
      expect(result.sources).toEqual(fakeSources)

      // Verify chunk IDs were extracted from object keys
      const chunkQuery = mockQuery.mock.calls[1]
      expect(chunkQuery[1][0]).toEqual(
        expect.arrayContaining(['chunk-x', 'chunk-y'])
      )
    })

    it('returns empty sources when chunks_retrieved is empty array', async () => {
      const fakeRun = {
        run_id: 'run-3',
        run_at: '2026-03-14T11:00:00Z',
        chunks_retrieved: [],
      }

      mockQuery.mockResolvedValueOnce({ rows: [fakeRun] })

      const result = await findRunProvenance('run-3')
      expect(result.sources).toEqual([])
      // Should NOT make a second query when there are no chunk IDs
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })

    it('returns empty sources when chunks_retrieved is null', async () => {
      const fakeRun = {
        run_id: 'run-4',
        run_at: '2026-03-14T12:00:00Z',
        chunks_retrieved: null,
      }

      mockQuery.mockResolvedValueOnce({ rows: [fakeRun] })

      const result = await findRunProvenance('run-4')
      expect(result.sources).toEqual([])
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })
  })

  // ── Immutability by omission ──────────────────────────────────────────
  describe('immutability enforcement', () => {
    it('does not export any update function', async () => {
      const mod = await import('../../src/db/queries/trustRuns.js')
      const names = Object.keys(mod)
      const updateFns = names.filter(
        (n) => /update|edit|modify|patch|set/i.test(n)
      )
      expect(updateFns).toEqual([])
    })

    it('does not export any delete function', async () => {
      const mod = await import('../../src/db/queries/trustRuns.js')
      const names = Object.keys(mod)
      const deleteFns = names.filter(
        (n) => /delete|remove|destroy|drop|purge/i.test(n)
      )
      expect(deleteFns).toEqual([])
    })
  })
})
