# Implementation Plan: Provenance Engine

## Overview

The provenance engine extends Research360's ingestion pipeline and query API to attach a complete origin chain to every chunk. The implementation follows the user's requested build order: schema first, then provenance service, pipeline changes, database queries, API endpoints, stale detection, refresh service, frontend rendering, and tests. Much of the infrastructure is already in place — this plan covers verification, gap-filling, and comprehensive testing.

## Tasks

- [x] 1. Schema migration and database layer
  - [x] 1.1 Verify and finalize `005_provenance_engine.sql` migration
    - Confirm the migration creates all required columns on `chunks`: `provenance`, `source_type`, `source_subtype`, `extraction_confidence`, `ingested_by`, `source_retrieved_at`, `source_uri`, `raw_snapshot_uri`, `snapshot_policy`, `is_stale`, `stale_since`, `is_superseded`, `superseded_at`, `superseded_by_chunk_id`, `previous_chunk_id`
    - Confirm `canonical_url` → `canonical_uri` rename from migration 004
    - Confirm `trust_runs` table with append-only trigger (`prevent_trust_runs_mutation`)
    - Confirm `trust_run_events` table with indexes on `run_id`, `event_at`, `event_type`
    - Confirm `chunk_reasoning_usages` table with FK to `chunks(id)` and `trust_runs(run_id)`, confidence CHECK constraint
    - Confirm all indexes: `idx_chunks_canonical_uri`, `idx_chunks_is_stale`, `idx_chunks_is_superseded`, `idx_chunks_source_retrieved_at`, `idx_chunks_superseded_by`, `idx_chunks_snapshot_policy`
    - All timestamp columns must be TIMESTAMPTZ (UTC)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 16.1, 16.4_

  - [x] 1.2 Verify `trustRuns.js` query module — INSERT only, no update/delete functions
    - Confirm `insertRun`, `findRunById`, `findRunProvenance` exist and work correctly
    - Confirm no UPDATE or DELETE query functions exist (immutability by omission)
    - _Requirements: 11.1, 11.2_

  - [x] 1.3 Verify `trustRunEvents.js` query module
    - Confirm `insertEvent` and `findEventsByRunId` exist
    - Confirm events returned ordered by `event_at ASC`
    - Confirm event_type values match v1 enum: `stale_flagged`, `refresh_triggered`, `refresh_completed`, `dispute_opened`, `dispute_closed`
    - _Requirements: 11.3, 14.3_

  - [x] 1.4 Verify `chunks.js` extended queries
    - Confirm `insertBatch` writes all 18 columns including provenance JSONB and indexed columns atomically
    - Confirm `findProvenanceByChunkId`, `markStale`, `markSuperseded`, `findStaleEligible`, `findByDocumentId` all exist
    - Confirm `markSuperseded` writes bidirectional linkage: `superseded_by_chunk_id` on old, `previous_chunk_id` on new
    - _Requirements: 2.2, 5.1, 5.5, 6.1, 6.2, 6.3, 7.1_

- [x] 2. Provenance service — object construction, taxonomy, confidence bands, response shaping
  - [x] 2.1 Verify `buildProvenanceObject` and `buildChunkRow` in `provenanceService.js`
    - Confirm `buildProvenanceObject` produces canonical JSONB with `schema_version: "1.0"`, correct `extraction`, `source`, `status`, and `reasoning` blocks
    - Confirm `buildChunkRow` derives all indexed columns from the canonical JSONB (single codepath, no independent writes)
    - Confirm `resolveSourceClass` maps `documents.source_type` → provenance taxonomy correctly: `document` → `file`, `url` → `web`, `youtube` → `audio/youtube`, `api` → `api`
    - Confirm layer assignment: L1 for direct uploads, L2 for company-scoped, L3 for web/discovery tier 3, L5 for API, discovery tier 1 → L1, tier 2 → L2
    - Confirm layer-to-policy mapping: L1 → static/null TTL, L2 → refresh_on_request, L3 → auto_refresh/stale_if_fetch_fails, L5 → auto_refresh/stale_if_fetch_fails
    - Confirm `reasoning` always `{ run_id: null, usages: [] }` and `status` always `{ is_stale: false, ... }` at construction
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 4.1, 4.2, 4.3, 4.4, 4.5, 7.1_

  - [x] 2.2 Write property tests for provenance object construction
    - **Property 1: Provenance object construction validity**
    - **Property 3: Provenance column/JSONB consistency at write (drift prevention)**
    - **Property 4: Layer-to-policy mapping**
    - **Property 21: L1/L3/L5 raw snapshot URI presence**
    - Create `api/tests/property/provenance-construction.prop.test.js`
    - Use `fast-check` arbitraries to generate random metadata inputs
    - Minimum 100 iterations per property
    - **Validates: Requirements 2.1, 2.2, 2.5, 2.7, 2.8, 4.2, 4.3, 4.4, 4.5, 7.1, 8.1**

  - [x] 2.3 Verify `validateSourceTaxonomy` in `provenanceService.js`
    - Confirm valid pairs return `{ valid: true }` for all 8 defined subtypes across 4 source types
    - Confirm invalid pairs return `{ valid: false, error: '...' }`
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 2.4 Write property test for source taxonomy validation
    - **Property 2: Source taxonomy validation**
    - Add to `api/tests/property/provenance-construction.prop.test.js`
    - Generate random string pairs and verify valid/invalid classification
    - **Validates: Requirements 2.3, 2.4, 2.6, 3.1, 3.2, 3.3**

  - [x] 2.5 Verify `shapeByDepth` allowlist response shaping in `provenanceService.js`
    - Confirm `summary` returns only: `schema_version`, `source.title`, `source.uri`, `source.retrieved_at`, `extraction.confidence_band`, `status.is_stale`, `status.is_superseded`
    - Confirm `internal` adds: `source_type`, `source_subtype`, `snapshot_policy`, `extraction.confidence`, `extraction.method`, `extraction.ingested_at`, `source.canonical_uri`, `source.version`, `source.freshness_policy`, full `status`
    - Confirm `full_internal` adds: `layer`, `extraction.ingested_by`, `source.raw_snapshot_uri`, `reasoning`
    - Confirm built additively from allowlist, not by stripping from full object
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 2.6 Write property tests for response shaping and confidence bands
    - **Property 12: Depth-based response shaping**
    - **Property 13: Confidence band mapping**
    - Create `api/tests/property/response-shaping.prop.test.js`
    - Generate random provenance objects and verify allowlist correctness at each depth
    - Generate random confidence floats and verify band boundaries (0.70, 0.90)
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.5, 10.1, 10.2, 10.3, 12.1**

  - [x] 2.7 Verify `mapConfidenceBand` in `provenanceService.js`
    - Confirm ≥0.90 → "Strong", ≥0.70 and <0.90 → "Moderate", <0.70 → "Check original"
    - Confirm null/undefined → "Check original"
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 3. Checkpoint — Ensure all provenance service tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Pipeline changes — extraction, transform, and chunk workers
  - [x] 4.1 Verify `extractionService.js` enriched return
    - Confirm `extract()` returns `{ text, extraction_confidence, extraction_method }` for all source types
    - Confirm confidence derivation: pdf → Unstructured.io signals, url → Playwright signals, youtube → Whisper confidence
    - Confirm PPTX handling: extracted via Unstructured.io, stored as `file/pdf` with `extra_metadata: { converted_from: 'pptx' }`
    - _Requirements: 2.5, 2.6_

  - [x] 4.2 Verify `extractionWorker.js` provenance_meta construction
    - Confirm worker builds `provenance_meta` object with: `source_type`, `file_type`, `source_url`, `canonical_uri`, `title`, `extraction_confidence`, `extraction_method`, `ingested_at`, `ingested_by`, `retrieved_at`, `raw_snapshot_uri`, `source_tier`, `company_id`
    - Confirm raw snapshot logic: L1 documents reference S3 original, L3/L5 URLs upload extracted text as snapshot, L2 company-scoped docs skip snapshot
    - Confirm `provenance_meta` is passed to `enqueue(EVENTS.CONTENT_EXTRACTED, ...)` in the job payload
    - _Requirements: 2.1, 2.2, 2.9, 2.10_

  - [x] 4.3 Verify `transformWorker.js` forwards `provenance_meta`
    - Confirm worker destructures `provenance_meta` from `job.data`
    - Confirm `provenance_meta` is forwarded to `enqueue(EVENTS.CONTENT_TRANSFORMED, ...)` in the job payload
    - _Requirements: 2.1_

  - [x] 4.4 Verify `chunkWorker.js` writes provenance atomically
    - Confirm worker destructures `provenance_meta` from `job.data`
    - Confirm worker calls `buildChunkRow(provenance_meta)` to produce the canonical provenance row
    - Confirm worker spreads `provenanceRow` into each chunk object passed to `insertBatch`
    - Confirm this is the SINGLE codepath that writes provenance to the database
    - _Requirements: 2.1, 2.2, 7.1_

- [x] 5. API endpoints — query with provenance, refresh, provenance lookup, trust runs
  - [x] 5.1 Verify `query.js` route accepts `provenance_depth`, `layers`, `run_id`
    - Confirm route destructures `provenance_depth` (default `'summary'`), `layers`, and `run_id` from request body
    - Confirm `layers` and `run_id` are passed to `retrieve()`
    - Confirm each source in response has `provenance` shaped by `shapeByDepth(s.provenance, provenance_depth)`
    - Confirm `chunk_id` is added to shaped provenance only at `full_internal` depth
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 5.2 Add `run_id` validation to `query.js` — return 404 if run_id provided but not found
    - When `run_id` is provided, verify it exists via `findRunById` before proceeding
    - Return 404 with `{ error: 'Trust run not found', code: 'RUN_NOT_FOUND' }` if not found
    - _Requirements: 12.5_

  - [x] 5.3 Verify `retrievalService.js` layer filtering and run-scoped reasoning
    - Confirm `layers` filter is applied as `c.provenance->>'layer' = ANY($N::text[])`
    - Confirm `run_id` triggers query to `chunk_reasoning_usages` table and injects reasoning block into provenance at query time
    - Confirm without `run_id`, provenance retains `reasoning: { run_id: null, usages: [] }`
    - _Requirements: 8.4, 8.5, 12.2, 12.4_

  - [x] 5.4 Write property tests for reasoning usage and run-scoped queries
    - **Property 10: Reasoning usage accumulation**
    - **Property 11: Run-scoped reasoning in query responses**
    - Create `api/tests/property/reasoning-usage.prop.test.js`
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.5, 12.2**

  - [x] 5.5 Verify `research.js` refresh route
    - Confirm POST `/api/research/refresh` accepts `chunk_ids`, `source_uris`, `canonical_uris`, `reason`, `company_id`, `run_id`
    - Confirm validation: at least one of `chunk_ids`, `source_uris`, `canonical_uris` required (400 otherwise)
    - Confirm response shape: `{ refreshed: [{ old_chunk_id, new_chunk_id, provenance }] }`
    - _Requirements: 13.1, 13.7_

  - [x] 5.6 Verify `provenance.js` route — GET `/api/research/provenance/:chunk_id`
    - Confirm returns full provenance object for the chunk
    - Confirm 404 with `CHUNK_NOT_FOUND` code when chunk doesn't exist
    - _Requirements: 14.1, 14.4_

  - [x] 5.7 Verify `trust.js` routes
    - Confirm GET `/api/trust/runs/:run_id/provenance` returns run provenance data
    - Confirm GET `/api/trust/runs/:run_id/events` returns events ordered by `event_at`
    - Confirm 404 for non-existent `run_id`
    - Confirm PUT/PATCH/DELETE on `/api/trust/runs/:run_id` return 405 (immutability enforcement)
    - _Requirements: 11.2, 14.2, 14.3, 14.4_

- [x] 6. Checkpoint — Ensure all API and pipeline tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Stale detection and refresh service
  - [x] 7.1 Verify `staleCronService.js` stale scan logic
    - Confirm `runStaleScan` calls `findStaleEligible` (chunks with `auto_refresh` policy, non-null TTL, expired)
    - Confirm eligible chunks are marked stale via `markStale`
    - Confirm chunks with `ttl_hours: null` are never flagged by the time-based rule
    - _Requirements: 5.2, 5.3_

  - [x] 7.2 Write property tests for stale and superseded independence
    - **Property 5: Stale and superseded independence**
    - **Property 6: TTL-based stale detection**
    - Create `api/tests/property/stale-superseded.prop.test.js`
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.5, 5.6**

  - [x] 7.3 Verify `refreshService.js` scope validation and supersession linkage
    - Confirm scope validation: L1 requires `raw_snapshot_uri`, L2 requires `company_id`, L3/L5 requires `source_uri` or `canonical_uri`
    - Confirm refresh writes supersession linkage via `markSuperseded` (bidirectional 1:1)
    - Confirm refresh writes `refresh_completed` event to `trust_run_events` when `runId` provided
    - Confirm v1 fan-out constraint: only first old→new chunk linked, warning logged
    - Confirm fetch failure marks chunks stale when `stale_if_fetch_fails: true`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [x] 7.4 Write property tests for supersession linkage and refresh scope
    - **Property 8: Supersession bidirectional linkage**
    - Create `api/tests/property/supersession-linkage.prop.test.js`
    - **Property 15: Refresh scope enforcement per layer**
    - Create `api/tests/property/refresh-scope.prop.test.js`
    - **Validates: Requirements 6.1, 6.2, 6.3, 13.2, 13.3, 13.4, 13.5**

  - [x] 7.5 Schedule stale detection cron job in `app.js`
    - Add BullMQ repeatable job for stale detection (e.g., hourly)
    - Wire `runStaleScan` to a BullMQ worker or call from existing scheduler
    - _Requirements: 5.2_

- [x] 8. Checkpoint — Ensure stale detection and refresh tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Frontend — SourceCard provenance rendering
  - [x] 9.1 Create `formatDisplayTimestamp` utility in `frontend/src/`
    - Implement using `Intl.DateTimeFormat` with `timeZone: 'Australia/Sydney'`
    - Output format: "sourced 20 Mar 2026"
    - Input: UTC ISO 8601 string from API
    - This utility lives in the frontend ONLY — never in API services
    - _Requirements: 15.4, 16.2, 16.3_

  - [x] 9.2 Extend `SourceCard.jsx` with provenance rendering
    - Display confidence band label (Strong / Moderate / Check original) from `provenance.extraction.confidence_band`
    - Display retrieved date using `formatDisplayTimestamp` from `provenance.source.retrieved_at`
    - Display stale warning badge when `provenance.status.is_stale === true`
    - Display superseded notice with "refresh available" CTA when `provenance.status.is_superseded === true`
    - Maintain existing source title, URI link, and relevance score display
    - _Requirements: 15.1, 15.2, 15.3_

  - [x] 9.3 Update `frontend/src/api/research360.js` query function to pass `provenance_depth`
    - Add `provenance_depth` parameter to the `query()` function (default: `'summary'`)
    - Pass through to the API request body
    - _Requirements: 12.1_

  - [x] 9.4 Write property test for timestamp formatting
    - **Property 18: Timestamp formatting (frontend-only)**
    - Create test for `formatDisplayTimestamp` utility
    - Generate random UTC ISO timestamps and verify Australia/Sydney output format
    - **Validates: Requirements 15.4, 16.2, 16.3, 16.4**

- [x] 10. Unit tests for edge cases and integration points
  - [x] 10.1 Write unit tests for provenance construction edge cases
    - Create `api/tests/unit/provenanceService.test.js`
    - Test confidence band boundary values: exactly 0.70 → Moderate, exactly 0.90 → Strong, null → Check original
    - Test PPTX mapping: stored as `file/pdf` with conversion note
    - Test L2 source with no file → null `raw_snapshot_uri`
    - Test default extraction confidence fallback (0.75 when not provided)
    - Test `shapeByDepth` with known full provenance object at each depth level
    - _Requirements: 2.5, 2.10, 9.1, 9.2, 9.3, 10.1, 10.2, 10.3_

  - [x] 10.2 Write unit tests for trust run immutability and route validation
    - Create `api/tests/unit/trustRoutes.test.js`
    - Test INSERT succeeds on `trust_runs`
    - Test 405 response for PUT/PATCH/DELETE on `/api/trust/runs/:run_id`
    - Test 404 for non-existent `run_id` on provenance and events endpoints
    - Test 404 for non-existent `chunk_id` on provenance lookup
    - _Requirements: 11.1, 11.2, 14.4_

  - [x] 10.3 Write unit tests for refresh scope validation
    - Create `api/tests/unit/refreshService.test.js`
    - Test L1 refresh without snapshot → error
    - Test L2 refresh without `company_id` → error
    - Test L3/L5 refresh without URI → error
    - Test fan-out refresh → only first chunk linked (v1 constraint)
    - _Requirements: 13.2, 13.3, 13.4, 6.4_

- [x] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The codebase already has significant provenance infrastructure implemented — many tasks are verification/gap-filling rather than greenfield
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All timestamps are UTC in storage and API responses; Australia/Sydney conversion is frontend-only
