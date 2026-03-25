# Requirements Document

## Introduction

The Provenance Engine is an internal Research360 capability that attaches an origin chain to every chunk and query result. It tracks where content came from, how it was extracted, how confident the system is at each step, and when the information was current. Products (Proof360, Trust360, Fund360) consume provenance and surface only the slice appropriate for their context via a depth-controlled allowlist model.

This spec covers: schema changes to the chunks table, new trust_runs and trust_run_events tables, provenance object construction at ingestion, stale/superseded lifecycle tracking, product response shaping by provenance depth, the refresh mechanism, and the API endpoints that expose provenance data.

## Glossary

- **Chunk**: A segment of extracted text stored in the `chunks` table with an embedding vector for semantic search.
- **Provenance**: The origin chain metadata attached to a chunk, describing its source, extraction method, confidence, freshness, and reasoning usage.
- **Provenance_Object**: The canonical JSONB envelope stored on each chunk containing the full provenance record at schema_version 1.0.
- **Extraction_Confidence**: A pipeline-owned normalised score (0–1) measuring how reliably a source was converted to structured text. Measured at ingestion.
- **Reasoning_Confidence**: A per-usage score (0–1) measuring how strongly the LLM reasoning layer used a chunk to support a conclusion in a specific step. Measured at reasoning time.
- **Source_Type**: Transport/infrastructure class of a chunk's origin. Fixed enum: `file`, `web`, `api`, `audio`.
- **Source_Subtype**: Channel/format classification. Initial enum: `pdf`, `docx`, `html`, `rss`, `json_api`, `xml_api`, `podcast`, `youtube`. Extensible by schema migration only.
- **Snapshot_Policy**: Refresh behaviour for a chunk. One of: `static`, `refresh_on_request`, `auto_refresh`.
- **Freshness_Policy**: TTL and fetch-failure rules governing stale detection for a chunk.
- **Trust_Run**: An immutable, append-only record of a Trust360 reasoning run stored in the `trust_runs` table.
- **Trust_Run_Event**: A lifecycle event associated with a trust run, stored in the `trust_run_events` table.
- **Provenance_Depth**: The level of detail returned in product API responses. One of: `summary`, `internal`, `full_internal`.
- **Layer**: Evidence layer classification (L1–L6). L1/L2/L3/L5 are persistent and provenance-bearing. L4 is transient. L6 is the immutable decision record.
- **Supersession**: The state where a chunk has been replaced by a newer version of the same source. Tracked via `is_superseded`, `superseded_by_chunk_id`, and `previous_chunk_id`.
- **Stale**: The freshness state where a chunk has not been verified as current recently, either by TTL expiry or fetch failure.
- **Ingestion_Pipeline**: The sequence of workers (extraction, transform, chunk, embedding) that process a source into indexed chunks.
- **Allowlist_Model**: The pattern where product responses are constructed by including only permitted fields per depth level, rather than stripping fields from a full object.
- **Confidence_Band**: A deterministic human-readable mapping of extraction_confidence to display labels: Strong (≥0.90), Moderate (≥0.70), Check original (<0.70).

## Requirements

### Requirement 1: Provenance Schema Migration

**User Story:** As a platform engineer, I want the chunks table extended with provenance columns and two new tables (trust_runs, trust_run_events) created, so that the database can store provenance metadata, trust run records, and lifecycle events.

#### Acceptance Criteria

1. WHEN the migration runs, THE Database SHALL add a `provenance` JSONB column (NOT NULL, default `'{}'`) to the `chunks` table.
2. WHEN the migration runs, THE Database SHALL add top-level indexed columns to the `chunks` table: `source_type` (VARCHAR 20), `source_subtype` (VARCHAR 30), `extraction_confidence` (FLOAT), `ingested_by` (VARCHAR 100), `source_retrieved_at` (TIMESTAMPTZ), `source_uri` (TEXT), `canonical_uri` (TEXT), `raw_snapshot_uri` (TEXT), `snapshot_policy` (VARCHAR 30, default `'static'`), `is_stale` (BOOLEAN, default FALSE), `stale_since` (TIMESTAMPTZ), `is_superseded` (BOOLEAN, default FALSE), `superseded_at` (TIMESTAMPTZ), `superseded_by_chunk_id` (UUID, FK to chunks.id), and `previous_chunk_id` (UUID, FK to chunks.id).
3. WHEN the migration runs, THE Database SHALL create indexes on `canonical_uri`, `is_stale`, `is_superseded`, `source_retrieved_at`, `superseded_by_chunk_id`, and `snapshot_policy`.
4. WHEN the migration runs, THE Database SHALL create a `trust_runs` table with columns: `run_id` (UUID PK), `company_id` (VARCHAR 100), `run_at` (TIMESTAMPTZ, default NOW()), `corpus_snapshot` (JSONB), `chunks_retrieved` (JSONB), `reasoning_steps` (JSONB), `gaps_identified` (JSONB), `vendor_resolutions` (JSONB), and `trust_scores` (JSONB).
5. WHEN the migration runs, THE Database SHALL create a `trust_run_events` table with columns: `event_id` (UUID PK), `run_id` (UUID, NOT NULL, FK to trust_runs.run_id), `event_type` (VARCHAR 50, NOT NULL), `event_at` (TIMESTAMPTZ, default NOW()), and `payload` (JSONB).
6. THE Database SHALL store all timestamp columns as TIMESTAMPTZ in UTC.

### Requirement 2: Provenance Object Construction at Ingestion

**User Story:** As a platform engineer, I want every chunk to carry a complete provenance record written atomically at ingestion time, so that the origin chain is captured from the moment content enters the system.

#### Acceptance Criteria

1. WHEN a chunk is created during ingestion, THE Ingestion_Pipeline SHALL write the Provenance_Object to the `provenance` JSONB column with `schema_version` set to `"1.0"`.
2. WHEN a chunk is created during ingestion, THE Ingestion_Pipeline SHALL write top-level indexed columns (`source_type`, `source_subtype`, `extraction_confidence`, `ingested_by`, `source_retrieved_at`, `source_uri`, `canonical_uri`, `raw_snapshot_uri`, `snapshot_policy`, `is_stale`, `is_superseded`) atomically in the same transaction as the `provenance` JSONB column.
3. WHEN a chunk is created during ingestion, THE Ingestion_Pipeline SHALL populate `provenance.source_type` with one of the fixed enum values: `file`, `web`, `api`, or `audio`.
4. WHEN a chunk is created during ingestion, THE Ingestion_Pipeline SHALL populate `provenance.source_subtype` with one of the defined initial enum values: `pdf`, `docx`, `html`, `rss`, `json_api`, `xml_api`, `podcast`, or `youtube`.
5. WHEN a chunk is created during ingestion, THE Ingestion_Pipeline SHALL set `provenance.extraction.confidence` to a normalised score between 0 and 1 derived from the extraction method signals.
6. WHEN a chunk is created during ingestion, THE Ingestion_Pipeline SHALL set `provenance.extraction.method` to the extraction tool used: `unstructured_io`, `playwright`, `whisper`, or `api_response`.
7. WHEN a chunk is created during ingestion, THE Ingestion_Pipeline SHALL set `provenance.reasoning` to `{ "run_id": null, "usages": [] }`.
8. WHEN a chunk is created during ingestion, THE Ingestion_Pipeline SHALL set `provenance.status` to `{ "is_stale": false, "stale_since": null, "is_superseded": false, "superseded_at": null, "superseded_by_chunk_id": null }`.
9. WHEN a chunk is created for an L1, L3, or L5 source, THE Ingestion_Pipeline SHALL store the `source.raw_snapshot_uri` pointing to the S3 key of the raw source snapshot.
10. WHEN a chunk is created for an L2 source with no raw file submitted, THE Ingestion_Pipeline SHALL set `source.raw_snapshot_uri` to null.

### Requirement 3: Source Taxonomy Enforcement

**User Story:** As a platform engineer, I want source classification to follow a strict two-level taxonomy, so that source types remain consistent and new subtypes require explicit schema migration.

#### Acceptance Criteria

1. THE Ingestion_Pipeline SHALL validate that `source_type` is one of the fixed enum values: `file`, `web`, `api`, `audio`.
2. THE Ingestion_Pipeline SHALL validate that `source_subtype` is one of the defined initial enum values: `pdf`, `docx`, `html`, `rss`, `json_api`, `xml_api`, `podcast`, `youtube`.
3. IF an ingestion request provides a `source_subtype` value not in the defined enum, THEN THE Ingestion_Pipeline SHALL reject the request with a validation error.

### Requirement 4: Snapshot and Freshness Policy

**User Story:** As a platform engineer, I want each chunk to carry a snapshot policy and freshness policy, so that the system can determine when and how to refresh content.

#### Acceptance Criteria

1. WHEN a chunk is created, THE Ingestion_Pipeline SHALL set `snapshot_policy` in both the top-level column and the Provenance_Object to one of: `static`, `refresh_on_request`, `auto_refresh`.
2. WHEN a chunk is created for an L1 source, THE Ingestion_Pipeline SHALL set `snapshot_policy` to `static` and `freshness_policy` to `{ "ttl_hours": null, "stale_if_fetch_fails": false }`.
3. WHEN a chunk is created for an L2 source, THE Ingestion_Pipeline SHALL set `snapshot_policy` to `refresh_on_request`.
4. WHEN a chunk is created for an L3 source, THE Ingestion_Pipeline SHALL set `snapshot_policy` to `auto_refresh` and `freshness_policy.stale_if_fetch_fails` to `true`.
5. WHEN a chunk is created for an L5 source, THE Ingestion_Pipeline SHALL set `snapshot_policy` to `auto_refresh` and `freshness_policy.stale_if_fetch_fails` to `true`.

### Requirement 5: Stale and Superseded Lifecycle Tracking

**User Story:** As a platform engineer, I want stale and superseded states tracked independently on each chunk, so that freshness and version lifecycle are never conflated.

#### Acceptance Criteria

1. THE Storage_Model SHALL track `is_stale` and `is_superseded` as independent boolean fields that are set and cleared independently.
2. WHILE `freshness_policy.ttl_hours` is not null, THE Stale_Detector SHALL set `is_stale` to true and record `stale_since` when `NOW()` exceeds `source_retrieved_at + ttl_hours`.
3. WHILE `freshness_policy.ttl_hours` is null, THE Stale_Detector SHALL leave `is_stale` unchanged by the time-based rule.
4. WHEN a fetch or crawl fails with a non-200 response or timeout AND `freshness_policy.stale_if_fetch_fails` is true, THE Stale_Detector SHALL set `is_stale` to true regardless of TTL.
5. WHEN a chunk is replaced by a newer version of the same source, THE Refresh_Service SHALL set `is_superseded` to true and record `superseded_at` on the old chunk without modifying `is_stale`.
6. THE Storage_Model SHALL permit a chunk to be in any combination of stale and superseded states: neither, stale only, superseded only, or both.

### Requirement 6: Supersession Lineage

**User Story:** As a platform engineer, I want bidirectional 1:1 linkage between old and new chunks on refresh, so that the version chain is navigable in both directions.

#### Acceptance Criteria

1. WHEN a chunk is superseded by a refresh, THE Refresh_Service SHALL set `superseded_by_chunk_id` on the old chunk to reference the new chunk.
2. WHEN a new chunk is created by a refresh, THE Refresh_Service SHALL set `previous_chunk_id` on the new chunk to reference the old chunk.
3. THE Refresh_Service SHALL maintain `superseded_by_chunk_id` and `previous_chunk_id` as a bidirectional 1:1 linkage.
4. IF a source refresh produces multiple replacement chunks, THEN THE Refresh_Service SHALL link only the first replacement chunk in the 1:1 linkage and document this as a known v1 constraint in the codebase.

### Requirement 7: Schema Authority Rule

**User Story:** As a platform engineer, I want a clear authority rule between top-level columns and the provenance JSONB, so that divergence is handled deterministically.

#### Acceptance Criteria

1. WHEN a chunk is written, THE Ingestion_Pipeline SHALL write top-level indexed columns and the `provenance` JSONB atomically in the same database transaction.
2. IF the top-level columns and `provenance` JSONB diverge, THEN THE API SHALL treat the `provenance` JSONB as authoritative for API responses.
3. THE API SHALL use top-level indexed columns for filtering, freshness checks, and joins.

### Requirement 8: Reasoning Usage Tracking

**User Story:** As a platform engineer, I want reasoning confidence tracked per usage per step within a trust run, so that audit replay can reconstruct the exact reasoning chain.

#### Acceptance Criteria

1. THE Provenance_Object SHALL store `reasoning.usages` as an array that is empty (`[]`) at rest and is never null.
2. WHEN a chunk is used in a Trust360 reasoning step, THE Reasoning_Service SHALL append a usage entry containing `step` (string), `step_index` (integer), `confidence` (float 0–1), and `used_at` (TIMESTAMPTZ UTC).
3. THE Reasoning_Service SHALL record each usage as a separate entry without overwriting or collapsing entries across steps.
4. WHEN a query includes a `run_id`, THE Query_API SHALL scope the `reasoning` block to that specific run only.
5. WHEN a query does not include a `run_id`, THE Query_API SHALL return `reasoning` as `{ "run_id": null, "usages": [] }`.

### Requirement 9: Product Response Shaping by Provenance Depth

**User Story:** As a platform engineer, I want product responses constructed from a per-depth allowlist, so that internal fields cannot leak to products that should not see them.

#### Acceptance Criteria

1. WHEN `provenance_depth` is `summary`, THE Query_API SHALL return only: `schema_version`, `source.title`, `source.uri`, `source.retrieved_at`, `extraction.confidence` mapped to a Confidence_Band, `status.is_stale`, and `status.is_superseded`.
2. WHEN `provenance_depth` is `internal`, THE Query_API SHALL return all `summary` fields plus: `source_type`, `source_subtype`, `source.canonical_uri`, `source.version`, `source.freshness_policy`, `extraction.method`, `extraction.ingested_at`, the full `status` object, and `snapshot_policy`.
3. WHEN `provenance_depth` is `full_internal`, THE Query_API SHALL return all `internal` fields plus: `layer`, `chunk_id`, `extraction.ingested_by`, `source.raw_snapshot_uri`, and the full `reasoning` object (run_id + usages array).
4. THE Query_API SHALL construct each depth response by building from the allowlist, not by stripping fields from the full internal object.
5. THE Query_API SHALL strip `layer` from all product responses unless `provenance_depth` is `full_internal`.

### Requirement 10: Confidence Band Mapping

**User Story:** As a product engineer, I want extraction confidence mapped to deterministic display bands, so that Proof360 and other products render consistent human-readable confidence labels.

#### Acceptance Criteria

1. WHEN `extraction.confidence` is greater than or equal to 0.90, THE Confidence_Mapper SHALL return `"Strong"`.
2. WHEN `extraction.confidence` is greater than or equal to 0.70 and less than 0.90, THE Confidence_Mapper SHALL return `"Moderate"`.
3. WHEN `extraction.confidence` is less than 0.70, THE Confidence_Mapper SHALL return `"Check original"`.
4. THE Confidence_Mapper SHALL apply the same mapping identically across all products.

### Requirement 11: Trust Runs Immutability

**User Story:** As a platform engineer, I want trust_runs to be append-only, so that decision records are immutable and auditable.

#### Acceptance Criteria

1. THE Trust_Runs_Table SHALL accept INSERT operations only.
2. THE API SHALL reject any request that attempts to UPDATE or DELETE a row in the `trust_runs` table.
3. THE Trust_Run_Events_Table SHALL carry all lifecycle state changes: `stale_flagged`, `refresh_triggered`, `refresh_completed`, `dispute_opened`, `dispute_closed`.

### Requirement 12: Research Query API

**User Story:** As a product engineer, I want to query Research360 with provenance depth control and optional run scoping, so that products receive appropriately shaped provenance in query results.

#### Acceptance Criteria

1. WHEN a POST request is made to `/api/research/query` with a `query` string and `provenance_depth`, THE Query_API SHALL return results containing `chunk_id`, `content`, `similarity_score`, and a `provenance` object shaped by the requested depth.
2. WHEN a `run_id` is provided in the query request, THE Query_API SHALL scope the reasoning block to that recorded run only.
3. THE Query_API SHALL treat the `run_id` parameter as read-only replay scope and SHALL NOT mutate the `trust_runs` table.
4. WHEN `layers` are provided in the query request, THE Query_API SHALL filter results to chunks belonging to the specified layers.
5. IF a provided `run_id` does not reference an existing trust run, THEN THE Query_API SHALL return a 404 error.

### Requirement 13: Refresh API Endpoint

**User Story:** As a platform engineer, I want an internal refresh endpoint that re-fetches sources and writes supersession linkage, so that content can be updated while preserving the version chain.

#### Acceptance Criteria

1. WHEN a POST request is made to `/api/research/refresh`, THE Refresh_API SHALL accept `chunk_ids`, `source_uris`, `canonical_uris`, `reason`, and `company_id` in the request body.
2. WHEN refreshing L3 or L5 chunks, THE Refresh_API SHALL scope the refresh by `source_uri` or `canonical_uri`.
3. WHEN refreshing L1 chunks, THE Refresh_API SHALL proceed only if a raw S3 snapshot exists or a new file is explicitly submitted.
4. WHEN refreshing L2 chunks, THE Refresh_API SHALL scope the refresh by `company_id`.
5. WHEN a refresh completes, THE Refresh_API SHALL write supersession linkage (setting `superseded_by_chunk_id` on old chunks and `previous_chunk_id` on new chunks).
6. WHEN a refresh completes, THE Refresh_API SHALL write a `refresh_completed` event to the `trust_run_events` table.
7. THE Refresh_API SHALL return a response containing `refreshed` array with `old_chunk_id`, `new_chunk_id`, and `provenance` for each refreshed chunk.

### Requirement 14: Provenance Lookup and Trust Run API Endpoints

**User Story:** As a platform engineer, I want internal-only endpoints to retrieve provenance for a specific chunk and to retrieve trust run provenance and events, so that internal tools can inspect the full provenance chain.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/research/provenance/:chunk_id`, THE Provenance_API SHALL return the full provenance object for the specified chunk.
2. WHEN a GET request is made to `/api/trust/runs/:run_id/provenance`, THE Trust_API SHALL return the provenance data for the specified trust run.
3. WHEN a GET request is made to `/api/trust/runs/:run_id/events`, THE Trust_API SHALL return all trust_run_events for the specified run ordered by `event_at`.
4. IF the specified `chunk_id` or `run_id` does not exist, THEN THE API SHALL return a 404 error.

### Requirement 15: Proof360 Surface Rendering

**User Story:** As a product engineer, I want Proof360 gap cards to display provenance-derived source information with stale/superseded warnings, so that users can assess source quality at a glance.

#### Acceptance Criteria

1. WHEN rendering a gap card source, THE Proof360_Surface SHALL display: source title, retrieved date formatted in Australia/Sydney timezone as human-readable text, Confidence_Band label, and source URI as a link.
2. WHEN `status.is_stale` is true, THE Proof360_Surface SHALL display a stale warning on the source.
3. WHEN `status.is_superseded` is true, THE Proof360_Surface SHALL display a superseded notice with a "refresh available" call-to-action.
4. THE Proof360_Surface SHALL render timestamps in Australia/Sydney timezone for display only, without storing timezone-converted values.

### Requirement 16: Timestamp Storage and Rendering

**User Story:** As a platform engineer, I want all timestamps stored in UTC and rendered in Australia/Sydney only for human-facing surfaces, so that temporal data is consistent and timezone-safe.

#### Acceptance Criteria

1. THE Database SHALL store all timestamp values as TIMESTAMPTZ in UTC.
2. WHEN rendering timestamps for human-facing surfaces, THE Presentation_Layer SHALL convert UTC timestamps to Australia/Sydney timezone.
3. THE Presentation_Layer SHALL format human-facing dates as readable text (e.g., "sourced 20 Mar 2026").
4. THE Storage_Layer SHALL never store AEST or AEDT timezone offsets in timestamp columns or JSONB fields.
