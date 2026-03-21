import { pool } from '../db/client.js'
import { config } from '../config/env.js'

const THIN_THRESHOLD = 50

/**
 * Generate a structured snapshot of corpus coverage for Claude's context.
 * Called once per discovery run.
 *
 * @returns {Promise<CoverageSummary>}
 */
export async function buildCoverageSummary() {
  const [totals, byFramework, byVendor, byJurisdiction, thinAreasResult] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*) FROM chunks)                                       AS chunks,
        (SELECT COUNT(DISTINCT tag) FROM chunks, UNNEST(framework_tags) AS tag) AS frameworks_covered,
        (SELECT COUNT(DISTINCT tag) FROM chunks, UNNEST(vendor_tags) AS tag)    AS vendors_covered
    `),
    pool.query(`
      SELECT
        tag,
        COUNT(*)                                                        AS chunk_count,
        MAX(last_validated)::TEXT                                       AS freshest,
        MIN(last_validated)::TEXT                                       AS stalest
      FROM chunks, UNNEST(framework_tags) AS tag
      GROUP BY tag
      ORDER BY chunk_count DESC
    `),
    pool.query(`
      SELECT
        tag,
        COUNT(*)                                                        AS chunk_count,
        MAX(last_validated)::TEXT                                       AS freshest,
        EXTRACT(DAY FROM NOW() - MAX(last_validated))::INTEGER         AS days_since_latest
      FROM chunks, UNNEST(vendor_tags) AS tag
      GROUP BY tag
      ORDER BY days_since_latest DESC
    `),
    pool.query(`
      SELECT
        COALESCE(jurisdiction, 'GLOBAL')              AS jurisdiction,
        COUNT(*)                                       AS chunk_count
      FROM chunks
      GROUP BY jurisdiction
      ORDER BY chunk_count DESC
    `),
    pool.query(`
      SELECT
        fw_tag                                        AS framework,
        COALESCE(jurisdiction, 'GLOBAL')              AS jurisdiction,
        COUNT(*)::INTEGER                             AS chunk_count
      FROM chunks, UNNEST(framework_tags) AS fw_tag
      GROUP BY fw_tag, jurisdiction
      HAVING COUNT(*) < $1
      ORDER BY chunk_count ASC
    `, [THIN_THRESHOLD]),
  ])

  const staleVendors = byVendor.rows.filter(
    v => v.days_since_latest >= config.VENDOR_STALENESS_DAYS
  )

  return {
    totals: {
      chunks:             parseInt(totals.rows[0]?.chunks || 0),
      vendors_covered:    parseInt(totals.rows[0]?.vendors_covered || 0),
      frameworks_covered: parseInt(totals.rows[0]?.frameworks_covered || 0),
    },
    coverage_by_framework: byFramework.rows.map(r => ({
      tag:         r.tag,
      chunk_count: parseInt(r.chunk_count),
      freshest:    r.freshest,
      stalest:     r.stalest,
    })),
    coverage_by_vendor: byVendor.rows.map(r => ({
      tag:               r.tag,
      chunk_count:       parseInt(r.chunk_count),
      freshest:          r.freshest,
      days_since_latest: parseInt(r.days_since_latest),
    })),
    coverage_by_jurisdiction: byJurisdiction.rows.map(r => ({
      jurisdiction: r.jurisdiction,
      chunk_count:  parseInt(r.chunk_count),
    })),
    stale_vendors: staleVendors.map(r => ({
      vendor:            r.tag,
      days_since_latest: r.days_since_latest,
    })),
    thin_areas: thinAreasResult.rows.map(r => ({
      framework:    r.framework,
      jurisdiction: r.jurisdiction,
      chunk_count:  parseInt(r.chunk_count),
    })),
  }
}
