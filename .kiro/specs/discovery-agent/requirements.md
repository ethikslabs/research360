# Requirements Document

## Introduction

The Discovery Agent is an autonomous layer for Research360 that keeps the corpus alive, current, and self-expanding without manual input. It answers one question on a nightly schedule: "What does this corpus not know that it should?" It operates across three modes — gap detection, vendor staleness, and horizon scanning — surfacing candidate URLs that are deduplicated, schema-validated, and auditable before entering the existing ingestion pipeline. The agent follows an advisory-first principle: every candidate is traceable and goes through either auto-ingest (high confidence) or a human review queue (moderate confidence).

## Glossary

- **Discovery_Agent**: The autonomous system that identifies corpus gaps and surfaces candidate URLs for ingestion into Research360.
- **Discovery_Worker**: The BullMQ worker that orchestrates a discovery run by calling Claude Sonnet with corpus context and processing the response.
- **Feed_Poller**: The service that collects raw items from configured RSS and JSON API feeds (CISA KEV, NVD CVE, ACSC, OAIC, NIST) for use as horizon scanning context.
- **Coverage_Summary_Service**: The service that generates a runtime JSON snapshot of current corpus coverage by framework, vendor, and jurisdiction.
- **Manifest_Validator**: The service that validates Claude's JSON output against the candidate schema before any database insert.
- **Canonicalizer**: The service that normalizes URLs (lowercase scheme/host, strip tracking params, remove trailing slashes, strip fragments) and checks for duplicates.
- **Review_Queue**: The set of API endpoints that allow a human operator to list, approve, or reject pending discovery candidates.
- **Candidate**: A URL surfaced by the Discovery Agent with metadata, confidence score, and justification, stored in the `discovery_candidates` table.
- **Discovery_Run**: A single execution of the Discovery Agent, tracked in the `discovery_runs` table with timing and count metrics.
- **Auto_Ingest**: The process by which candidates with confidence >= 0.85 are automatically queued for ingestion without human review.
- **Corpus**: The collection of all chunks stored in Research360's pgvector database.
- **Source_Tier**: A ranking of source authority: Tier 1 (government/framework bodies), Tier 2 (vendor pages), Tier 3 (other).
- **Seed_Feed**: A preconfigured external data source (e.g., CISA KEV, NVD CVE) polled for horizon scanning context.
- **Thin_Area**: A framework-jurisdiction combination with fewer than 50 chunks in the corpus.
- **Stale_Vendor**: A vendor whose most recent corpus entry is older than VENDOR_STALENESS_DAYS (default 30 days).

## Requirements

### Requirement 1: Database Schema for Discovery

**User Story:** As a platform operator, I want dedicated database tables for discovery candidates and run metrics, so that all discovery activity is persisted and auditable.

#### Acceptance Criteria

1. THE Migration SHALL create a `discovery_candidates` table with columns: `candidate_id` (UUID PK), `run_id` (UUID NOT NULL), `url` (TEXT NOT NULL), `canonical_url` (TEXT NOT NULL), `source_domain` (TEXT), `source_feed` (TEXT), `source_type` (VARCHAR(20) NOT NULL), `source_tier` (INTEGER, constrained to 1/2/3), `jurisdiction` (VARCHAR(10) NOT NULL DEFAULT 'GLOBAL'), `framework_tags` (TEXT[]), `vendor_tags` (TEXT[]), `discovery_mode` (VARCHAR(30) NOT NULL), `justification` (TEXT NOT NULL), `confidence` (NUMERIC(3,2), constrained 0–1), `auto_ingest` (BOOLEAN DEFAULT FALSE), `status` (VARCHAR(20) NOT NULL DEFAULT 'pending'), `review_reason` (TEXT), `error_message` (TEXT), `content_fingerprint` (TEXT), `ingest_job_id` (UUID NULL), `generated_at` (TIMESTAMPTZ), and `actioned_at` (TIMESTAMPTZ).
2. THE Migration SHALL create indexes on `discovery_candidates` for `status`, `run_id`, and `canonical_url`.
3. THE Migration SHALL create a `discovery_runs` table with columns: `run_id` (UUID PK), `started_at` (TIMESTAMPTZ), `completed_at` (TIMESTAMPTZ), `candidates_generated` (INTEGER DEFAULT 0), `candidates_inserted` (INTEGER DEFAULT 0), `candidates_auto_ingested` (INTEGER DEFAULT 0), `candidates_pending_review` (INTEGER DEFAULT 0), `candidates_rejected_dedupe` (INTEGER DEFAULT 0), `feed_sources_polled` (INTEGER DEFAULT 0), `feed_source_failures` (INTEGER DEFAULT 0), `claude_latency_ms` (INTEGER), `total_run_duration_ms` (INTEGER), `error_message` (TEXT), and `status` (VARCHAR(20) DEFAULT 'running').
4. THE Migration SHALL add columns to the existing `chunks` table: `source_url` (TEXT), `canonical_url` (TEXT), `source_tier` (INTEGER, constrained to 1/2/3), `jurisdiction` (VARCHAR(10) DEFAULT 'GLOBAL'), `framework_tags` (TEXT[]), `vendor_tags` (TEXT[]), `last_validated` (TIMESTAMPTZ DEFAULT NOW()), and `discovery_candidate_id` (UUID, FK to `discovery_candidates`).
5. THE Migration SHALL create indexes on `chunks` for `canonical_url` and `last_validated`.

### Requirement 2: URL Canonicalization and Deduplication

**User Story:** As a platform operator, I want all candidate URLs normalized and deduplicated before insert, so that the corpus does not contain redundant content.

#### Acceptance Criteria

1. WHEN a URL is received, THE Canonicalizer SHALL lowercase the scheme and host.
2. WHEN a URL is received, THE Canonicalizer SHALL remove tracking parameters (`utm_*`, `ref`, `source`).
3. WHEN a URL is received, THE Canonicalizer SHALL remove trailing slashes.
4. WHEN a URL is received, THE Canonicalizer SHALL strip URL fragments.
5. WHEN a candidate's `canonical_url` already exists in `chunks.canonical_url`, THE Canonicalizer SHALL discard the candidate.
6. WHEN a candidate's `canonical_url` already exists in `discovery_candidates` with status `pending`, `approved`, or `ingested` within the last DEDUPE_LOOKBACK_DAYS, THE Canonicalizer SHALL discard the candidate.
7. WHEN a candidate has the same `vendor_tags`, `framework_tags`, and `source_domain` combination as an active candidate within the DEDUPE_LOOKBACK_DAYS window, THE Canonicalizer SHALL discard the candidate.
8. WHEN a candidate is discarded by deduplication, THE Discovery_Agent SHALL increment `candidates_rejected_dedupe` in the run metrics and not write the candidate to `discovery_candidates`.

### Requirement 3: Coverage Summary Service

**User Story:** As the Discovery Agent, I need a runtime snapshot of corpus coverage, so that Claude can reason about what the corpus is missing.

#### Acceptance Criteria

1. WHEN a discovery run starts, THE Coverage_Summary_Service SHALL generate a JSON object containing: `totals` (chunk count, vendors covered, frameworks covered), `coverage_by_framework` (tag, chunk count, freshest timestamp, stalest timestamp per framework), `coverage_by_vendor` (tag, chunk count, freshest timestamp, days since latest per vendor), `coverage_by_jurisdiction` (jurisdiction, chunk count), `stale_vendors` (vendors with days_since_latest >= VENDOR_STALENESS_DAYS), and `thin_areas` (framework-jurisdiction pairs with chunk_count < 50).
2. THE Coverage_Summary_Service SHALL query the `chunks` table directly and not pass raw SQL groupings to Claude.
3. THE Coverage_Summary_Service SHALL classify a vendor as stale when `days_since_latest` >= VENDOR_STALENESS_DAYS (default 30).
4. THE Coverage_Summary_Service SHALL classify a framework-jurisdiction pair as thin when `chunk_count` < 50.

### Requirement 4: Feed Poller

**User Story:** As the Discovery Agent, I need raw feed items from trusted external sources, so that horizon scanning has current threat and framework intelligence.

#### Acceptance Criteria

1. WHEN a discovery run starts, THE Feed_Poller SHALL poll all configured Seed_Feeds and return raw feed items.
2. THE Feed_Poller SHALL support both RSS and JSON API feed types.
3. THE Feed_Poller SHALL filter feed items to those published within the last HORIZON_LOOKBACK_HOURS (default 24 hours).
4. IF a single feed source fails to respond, THEN THE Feed_Poller SHALL log the failure, increment `feed_source_failures` in run metrics, and continue polling remaining feeds.
5. THE Feed_Poller SHALL record the total number of feeds polled in `feed_sources_polled` in run metrics.
6. THE Feed_Poller SHALL include the five preconfigured Seed_Feeds: CISA KEV, NVD CVE, ACSC Alerts, OAIC Breach Register, and NIST News.

### Requirement 5: Manifest Validation

**User Story:** As a platform operator, I want Claude's output schema-validated before any database write, so that malformed data never enters the candidate pipeline.

#### Acceptance Criteria

1. WHEN Claude returns output, THE Manifest_Validator SHALL verify the output is a valid JSON array.
2. WHEN Claude returns output, THE Manifest_Validator SHALL verify each candidate contains all required fields: `url`, `source_type`, `source_tier`, `source_domain`, `jurisdiction`, `framework_tags`, `vendor_tags`, `discovery_mode`, `justification`, and `confidence`.
3. WHEN a candidate's `confidence` value is outside the range 0.0–1.0, THE Manifest_Validator SHALL reject that candidate.
4. WHEN a candidate's `source_tier` is not 1, 2, or 3, THE Manifest_Validator SHALL reject that candidate.
5. WHEN a candidate's `jurisdiction` is not one of `AU`, `US`, `EU`, or `GLOBAL`, THE Manifest_Validator SHALL reject that candidate.
6. WHEN a candidate's `url` is not a valid URL, THE Manifest_Validator SHALL reject that candidate.
7. WHEN a candidate's `discovery_mode` is not one of `gap_detection`, `vendor_staleness`, or `horizon_scan`, THE Manifest_Validator SHALL reject that candidate.
8. WHEN a candidate's `justification` is empty, THE Manifest_Validator SHALL reject that candidate.
9. IF Claude's entire output fails JSON parsing, THEN THE Manifest_Validator SHALL reject the entire run and log the parse failure to the run's `error_message`.
10. WHEN an individual candidate fails schema validation, THE Manifest_Validator SHALL reject that candidate without silently coercing values, and log the validation failure.

### Requirement 6: Discovery Worker

**User Story:** As a platform operator, I want an autonomous nightly worker that identifies corpus gaps using Claude Sonnet, so that the corpus stays current without manual intervention.

#### Acceptance Criteria

1. WHEN the nightly BullMQ job fires, THE Discovery_Worker SHALL create a new `discovery_runs` record with status `running`.
2. THE Discovery_Worker SHALL gather context by calling the Coverage_Summary_Service, loading the vendor catalog, and collecting Feed_Poller results.
3. THE Discovery_Worker SHALL call Claude Sonnet with the discovery prompt, passing `corpus_summary`, `vendor_catalog`, and `feed_items` as context.
4. THE Discovery_Worker SHALL enforce candidate budgets per mode: maximum 8 for `gap_detection`, maximum 6 for `vendor_staleness`, maximum 6 for `horizon_scan`, and maximum 20 total per run.
5. WHEN Claude returns candidates, THE Discovery_Worker SHALL pass them through the Manifest_Validator, then the Canonicalizer for URL normalization and deduplication, before any database insert.
6. WHEN a validated, deduplicated candidate has confidence >= 0.85, THE Discovery_Worker SHALL set `auto_ingest` to true and `status` to `approved`.
7. WHEN a validated, deduplicated candidate has confidence >= 0.60 and < 0.85, THE Discovery_Worker SHALL set `status` to `pending` for human review.
8. WHEN a validated, deduplicated candidate has confidence < 0.60, THE Discovery_Worker SHALL discard the candidate.
9. THE Discovery_Worker SHALL be idempotent per `run_id`: re-running with the same `run_id` produces no duplicate candidates.
10. THE Discovery_Worker SHALL write a full candidate record to `discovery_candidates` before any ingest action, including for auto-ingested candidates.
11. WHEN a candidate is auto-ingested, THE Discovery_Worker SHALL POST to the existing `/api/ingest` endpoint and write the returned `ingest_job_id` back to the candidate record.
12. WHEN a discovery run completes, THE Discovery_Worker SHALL update the `discovery_runs` record with `completed_at`, all candidate counts, `claude_latency_ms`, `total_run_duration_ms`, and `status` set to `completed`.
13. THE Discovery_Worker SHALL record `claude_latency_ms` measuring the duration of the Claude API call.

### Requirement 7: BullMQ Nightly Schedule

**User Story:** As a platform operator, I want the discovery agent to run automatically on a nightly schedule, so that corpus freshness is maintained without manual triggers.

#### Acceptance Criteria

1. THE Discovery_Agent SHALL register a repeatable BullMQ job that fires on a nightly cron schedule.
2. WHEN the scheduled job fires, THE Discovery_Agent SHALL invoke the Discovery_Worker.
3. IF the Discovery_Worker encounters an unrecoverable error, THEN THE Discovery_Agent SHALL update the `discovery_runs` record with status `failed` and the error message.

### Requirement 8: Review Queue API

**User Story:** As a platform operator, I want API endpoints to review, approve, and reject pending discovery candidates, so that moderate-confidence candidates receive human oversight.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/discovery/pending`, THE Review_Queue SHALL return all candidates with status `pending`.
2. WHEN a GET request is made to `/api/discovery/runs`, THE Review_Queue SHALL return recent discovery run summaries.
3. WHEN a POST request is made to `/api/discovery/:id/approve`, THE Review_Queue SHALL set the candidate status to `approved`, set `actioned_at` to the current timestamp, and POST the candidate URL to the existing `/api/ingest` endpoint.
4. WHEN a candidate is approved and ingest is triggered, THE Review_Queue SHALL write the returned `ingest_job_id` back to the candidate record.
5. WHEN a POST request is made to `/api/discovery/:id/reject`, THE Review_Queue SHALL require a `reason` string in the request body, set the candidate status to `rejected`, set `review_reason` to the provided reason, and set `actioned_at` to the current timestamp.
6. IF an approve or reject request references a candidate that is not in `pending` status, THEN THE Review_Queue SHALL return an error indicating the candidate is not actionable.

### Requirement 9: Configuration Constants

**User Story:** As a developer, I want all discovery thresholds and limits defined as environment/config values, so that tuning does not require code changes.

#### Acceptance Criteria

1. THE Discovery_Agent SHALL read the following values from environment or config: `AUTO_INGEST_THRESHOLD` (default 0.85), `REVIEW_THRESHOLD` (default 0.60), `DISCARD_THRESHOLD` (default 0.60), `VENDOR_STALENESS_DAYS` (default 30), `HORIZON_LOOKBACK_HOURS` (default 24), `DISCOVERY_MAX_CANDIDATES` (default 20), `DISCOVERY_MAX_GAP` (default 8), `DISCOVERY_MAX_STALENESS` (default 6), `DISCOVERY_MAX_HORIZON` (default 6), and `DEDUPE_LOOKBACK_DAYS` (default 30).
2. THE Discovery_Agent SHALL not embed threshold or limit values in prompt text or worker logic.

### Requirement 10: Implementation Guardrails

**User Story:** As a platform operator, I want strict operational guardrails on the discovery pipeline, so that the system is safe, auditable, and resilient to partial failures.

#### Acceptance Criteria

1. THE Discovery_Agent SHALL be idempotent per `run_id`: repeated execution with the same `run_id` produces no duplicate side effects.
2. THE Discovery_Agent SHALL write a candidate record to `discovery_candidates` before triggering any ingest action.
3. THE Discovery_Agent SHALL canonicalize all URLs before deduplication or database insert.
4. THE Discovery_Agent SHALL validate all Claude output against the candidate schema before database insert.
5. IF a feed source fails during polling, THEN THE Discovery_Agent SHALL continue the run with partial feed data and log the failure.
6. WHEN a discovery run completes, THE Discovery_Agent SHALL emit run metrics to the `discovery_runs` table including all candidate counts, timing data, and feed polling statistics.
7. THE Discovery_Agent SHALL run deduplication before insert, not after.
