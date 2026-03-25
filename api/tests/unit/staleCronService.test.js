import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock chunks queries before importing the module under test
const mockFindStaleEligible = vi.fn()
const mockMarkStale = vi.fn()

vi.mock('../../src/db/queries/chunks.js', () => ({
  findStaleEligible: (...args) => mockFindStaleEligible(...args),
  markStale: (...args) => mockMarkStale(...args),
}))

const { runStaleScan } = await import('../../src/services/staleCronService.js')

describe('staleCronService.js — Task 7.1', () => {
  beforeEach(() => {
    mockFindStaleEligible.mockReset()
    mockMarkStale.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  // Requirement 5.2: runStaleScan calls findStaleEligible and marks results stale
  it('calls findStaleEligible and marks returned chunks stale via markStale', async () => {
    const eligible = [{ id: 'chunk-1' }, { id: 'chunk-2' }]
    mockFindStaleEligible.mockResolvedValueOnce(eligible)
    mockMarkStale.mockResolvedValueOnce(undefined)

    const result = await runStaleScan()

    expect(mockFindStaleEligible).toHaveBeenCalledOnce()
    expect(mockMarkStale).toHaveBeenCalledOnce()

    const [ids, staleSince] = mockMarkStale.mock.calls[0]
    expect(ids).toEqual(['chunk-1', 'chunk-2'])
    expect(typeof staleSince).toBe('string') // ISO timestamp
    expect(result).toEqual({ marked: 2, chunk_ids: ['chunk-1', 'chunk-2'] })
  })

  // Requirement 5.2: returns zero when no chunks are eligible
  it('returns { marked: 0 } and skips markStale when no chunks are eligible', async () => {
    mockFindStaleEligible.mockResolvedValueOnce([])

    const result = await runStaleScan()

    expect(mockFindStaleEligible).toHaveBeenCalledOnce()
    expect(mockMarkStale).not.toHaveBeenCalled()
    expect(result).toEqual({ marked: 0 })
  })

  // Requirement 5.3: chunks with ttl_hours: null are excluded by findStaleEligible's SQL
  // This is enforced at the query level — findStaleEligible only returns chunks with
  // non-null ttl_hours and auto_refresh policy. We verify the service trusts that contract.
  it('only processes chunks returned by findStaleEligible (null-TTL chunks excluded at query level)', async () => {
    // Simulate findStaleEligible returning only TTL-bearing chunks (query excludes null TTL)
    const eligible = [{ id: 'ttl-chunk' }]
    mockFindStaleEligible.mockResolvedValueOnce(eligible)
    mockMarkStale.mockResolvedValueOnce(undefined)

    const result = await runStaleScan()

    expect(mockMarkStale).toHaveBeenCalledWith(['ttl-chunk'], expect.any(String))
    expect(result.marked).toBe(1)
  })
})
