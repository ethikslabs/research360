import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock pool and embedText before importing the module under test
const mockQuery = vi.fn()
vi.mock('../../src/db/client.js', () => ({
  pool: { query: (...args) => mockQuery(...args) },
}))
vi.mock('../../src/services/embeddingService.js', () => ({
  embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}))

const { retrieve } = await import('../../src/services/retrievalService.js')

describe('retrievalService.js — Task 5.3', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  // ── Layers filter: c.provenance->>'layer' = ANY($N::text[]) ──────────
  describe('layers filter (Req 12.4)', () => {
    it('applies layers filter as parameterised ANY($N::text[]) clause', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await retrieve({
        query: 'test',
        tenantId: 'ethikslabs',
        layers: ['L1', 'L3'],
      })

      const [sql, params] = mockQuery.mock.calls[0]
      // Must use $3::text[] (parameterised), not a literal
      expect(sql).toMatch(/c\.provenance->>'layer' = ANY\(\$3::text\[\]\)/)
      expect(params[2]).toEqual(['L1', 'L3'])
    })

    it('increments param index correctly when other filters are present', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await retrieve({
        query: 'test',
        tenantId: 'ethikslabs',
        filters: { source_type: 'file' },
        layers: ['L2'],
      })

      const [sql, params] = mockQuery.mock.calls[0]
      // source_type takes $3, layers takes $4
      expect(sql).toMatch(/d\.source_type = \$3/)
      expect(sql).toMatch(/c\.provenance->>'layer' = ANY\(\$4::text\[\]\)/)
      expect(params[2]).toBe('file')
      expect(params[3]).toEqual(['L2'])
    })

    it('omits layers clause when layers is undefined', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await retrieve({ query: 'test', tenantId: 'ethikslabs' })

      const sql = mockQuery.mock.calls[0][0]
      expect(sql).not.toMatch(/provenance.*layer/)
    })

    it('omits layers clause when layers is empty array', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await retrieve({ query: 'test', tenantId: 'ethikslabs', layers: [] })

      const sql = mockQuery.mock.calls[0][0]
      expect(sql).not.toMatch(/provenance.*layer/)
    })
  })

  // ── Run-scoped reasoning injection (Req 8.4, 8.5, 12.2) ─────────────
  describe('run-scoped reasoning (Req 8.4, 8.5, 12.2)', () => {
    const baseRow = {
      chunk_id: 'chunk-1',
      chunk_text: 'some text',
      chunk_index: 0,
      provenance: { schema_version: '1.0', reasoning: { run_id: null, usages: [] } },
      relevance_score: 0.85,
    }

    it('queries chunk_reasoning_usages and injects reasoning block when run_id provided', async () => {
      // First call: main retrieval query
      mockQuery.mockResolvedValueOnce({ rows: [{ ...baseRow }] })
      // Second call: reasoning usages query
      mockQuery.mockResolvedValueOnce({
        rows: [
          { chunk_id: 'chunk-1', step: 'evidence_gathering', step_index: 0, confidence: 0.92, used_at: '2026-03-14T10:00:00Z' },
          { chunk_id: 'chunk-1', step: 'gap_analysis', step_index: 1, confidence: 0.88, used_at: '2026-03-14T10:01:00Z' },
        ],
      })

      const rows = await retrieve({
        query: 'test',
        tenantId: 'ethikslabs',
        run_id: 'run-abc',
      })

      // Verify the usages query targets chunk_reasoning_usages
      const [usagesSql, usagesParams] = mockQuery.mock.calls[1]
      expect(usagesSql).toMatch(/chunk_reasoning_usages/)
      expect(usagesSql).toMatch(/run_id = \$1/)
      expect(usagesSql).toMatch(/chunk_id = ANY\(\$2::uuid\[\]\)/)
      expect(usagesParams[0]).toBe('run-abc')
      expect(usagesParams[1]).toEqual(['chunk-1'])

      // Verify reasoning block injected into provenance
      expect(rows[0].provenance.reasoning).toEqual({
        run_id: 'run-abc',
        usages: [
          { step: 'evidence_gathering', step_index: 0, confidence: 0.92, used_at: '2026-03-14T10:00:00Z' },
          { step: 'gap_analysis', step_index: 1, confidence: 0.88, used_at: '2026-03-14T10:01:00Z' },
        ],
      })
    })

    it('sets reasoning to { run_id, usages: [] } for chunks with no usages in that run', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ ...baseRow }] })
      // No usages found for this run
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const rows = await retrieve({
        query: 'test',
        tenantId: 'ethikslabs',
        run_id: 'run-xyz',
      })

      // Req 8.4: reasoning scoped to run even when empty
      expect(rows[0].provenance.reasoning).toEqual({
        run_id: 'run-xyz',
        usages: [],
      })
    })

    it('retains default reasoning { run_id: null, usages: [] } without run_id', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ ...baseRow }] })

      const rows = await retrieve({
        query: 'test',
        tenantId: 'ethikslabs',
      })

      // Only one query (no usages lookup)
      expect(mockQuery).toHaveBeenCalledTimes(1)
      // Provenance reasoning untouched
      expect(rows[0].provenance.reasoning).toEqual({
        run_id: null,
        usages: [],
      })
    })

    it('distributes usages correctly across multiple chunks', async () => {
      const row1 = { ...baseRow, chunk_id: 'c1', relevance_score: 0.9 }
      const row2 = { ...baseRow, chunk_id: 'c2', relevance_score: 0.8 }
      mockQuery.mockResolvedValueOnce({ rows: [{ ...row1 }, { ...row2 }] })
      mockQuery.mockResolvedValueOnce({
        rows: [
          { chunk_id: 'c1', step: 'step_a', step_index: 0, confidence: 0.95, used_at: '2026-01-01T00:00:00Z' },
          // c2 has no usages in this run
        ],
      })

      const rows = await retrieve({
        query: 'test',
        tenantId: 'ethikslabs',
        run_id: 'run-multi',
      })

      expect(rows[0].provenance.reasoning).toEqual({
        run_id: 'run-multi',
        usages: [{ step: 'step_a', step_index: 0, confidence: 0.95, used_at: '2026-01-01T00:00:00Z' }],
      })
      // c2 gets scoped reasoning with empty usages
      expect(rows[1].provenance.reasoning).toEqual({
        run_id: 'run-multi',
        usages: [],
      })
    })

    it('skips usages lookup when run_id provided but no rows returned', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      const rows = await retrieve({
        query: 'test',
        tenantId: 'ethikslabs',
        run_id: 'run-empty',
      })

      // Only the main query, no usages lookup
      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(rows).toEqual([])
    })
  })

  // ── Filter parameter correctness ─────────────────────────────────────
  describe('filter parameter placeholders', () => {
    it('uses $3 for source_type filter', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await retrieve({
        query: 'test',
        tenantId: 'ethikslabs',
        filters: { source_type: 'web' },
      })

      const [sql, params] = mockQuery.mock.calls[0]
      expect(sql).toMatch(/d\.source_type = \$3/)
      expect(params[2]).toBe('web')
    })

    it('uses $3 for document_id filter', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })

      await retrieve({
        query: 'test',
        tenantId: 'ethikslabs',
        filters: { document_id: 'doc-1' },
      })

      const [sql, params] = mockQuery.mock.calls[0]
      expect(sql).toMatch(/c\.document_id = \$3/)
      expect(params[2]).toBe('doc-1')
    })
  })
})
