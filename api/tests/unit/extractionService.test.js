import { describe, it, expect } from 'vitest'
import {
  deriveUnstructuredConfidence,
  derivePlaywrightConfidence,
  deriveApiConfidence,
  DEFAULT_CONFIDENCE,
} from '../../src/services/extractionService.js'

describe('extractionService — confidence derivation helpers', () => {
  describe('DEFAULT_CONFIDENCE', () => {
    it('should be 0.75', () => {
      expect(DEFAULT_CONFIDENCE).toBe(0.75)
    })
  })

  describe('deriveUnstructuredConfidence', () => {
    it('returns DEFAULT_CONFIDENCE for empty elements array', () => {
      expect(deriveUnstructuredConfidence([])).toBe(DEFAULT_CONFIDENCE)
    })

    it('returns DEFAULT_CONFIDENCE for null/undefined input', () => {
      expect(deriveUnstructuredConfidence(null)).toBe(DEFAULT_CONFIDENCE)
      expect(deriveUnstructuredConfidence(undefined)).toBe(DEFAULT_CONFIDENCE)
    })

    it('returns DEFAULT_CONFIDENCE when no elements have confidence metadata', () => {
      const elements = [{ text: 'hello' }, { text: 'world' }]
      expect(deriveUnstructuredConfidence(elements)).toBe(DEFAULT_CONFIDENCE)
    })

    it('averages detection_class_prob across elements', () => {
      const elements = [
        { text: 'a', metadata: { detection_class_prob: 0.9 } },
        { text: 'b', metadata: { detection_class_prob: 0.7 } },
      ]
      expect(deriveUnstructuredConfidence(elements)).toBeCloseTo(0.8)
    })

    it('falls back to metadata.confidence when detection_class_prob is absent', () => {
      const elements = [
        { text: 'a', metadata: { confidence: 0.95 } },
        { text: 'b', metadata: { confidence: 0.85 } },
      ]
      expect(deriveUnstructuredConfidence(elements)).toBeCloseTo(0.9)
    })

    it('clamps result to [0, 1]', () => {
      const elements = [{ text: 'a', metadata: { detection_class_prob: 1.5 } }]
      expect(deriveUnstructuredConfidence(elements)).toBeLessThanOrEqual(1)
    })
  })

  describe('derivePlaywrightConfidence', () => {
    it('returns DEFAULT_CONFIDENCE for empty text', () => {
      expect(derivePlaywrightConfidence('', 100, 50)).toBe(DEFAULT_CONFIDENCE)
    })

    it('returns DEFAULT_CONFIDENCE when bodyLen is 0', () => {
      expect(derivePlaywrightConfidence('content', 0, 0)).toBe(DEFAULT_CONFIDENCE)
    })

    it('returns higher confidence when article is most of the body', () => {
      const conf = derivePlaywrightConfidence('content', 1000, 900)
      expect(conf).toBeGreaterThan(0.9)
    })

    it('returns lower confidence when article is small fraction of body', () => {
      const conf = derivePlaywrightConfidence('content', 1000, 100)
      expect(conf).toBeLessThan(0.7)
    })

    it('clamps result to [0, 1]', () => {
      const conf = derivePlaywrightConfidence('content', 100, 100)
      expect(conf).toBeLessThanOrEqual(1)
      expect(conf).toBeGreaterThanOrEqual(0)
    })
  })

  describe('deriveApiConfidence', () => {
    it('returns ratio of non-null fields for valid JSON', () => {
      const json = JSON.stringify({ a: 'val', b: null, c: 'val2', d: '' })
      // 2 non-null non-empty out of 4
      expect(deriveApiConfidence(json)).toBeCloseTo(0.5)
    })

    it('returns 1.0 when all fields are populated', () => {
      const json = JSON.stringify({ a: 1, b: 'two', c: true })
      expect(deriveApiConfidence(json)).toBeCloseTo(1.0)
    })

    it('returns DEFAULT_CONFIDENCE for empty object', () => {
      expect(deriveApiConfidence('{}')).toBe(DEFAULT_CONFIDENCE)
    })

    it('returns DEFAULT_CONFIDENCE for non-JSON text', () => {
      expect(deriveApiConfidence('<xml>not json</xml>')).toBe(DEFAULT_CONFIDENCE)
    })

    it('returns DEFAULT_CONFIDENCE for invalid JSON', () => {
      expect(deriveApiConfidence('not json at all')).toBe(DEFAULT_CONFIDENCE)
    })
  })
})
