# Implementation Plan: Research360 API

## Overview

Build the Research360 API in two phases following the design document's strict build order. Phase 1 establishes the foundation (config, database, queue, S3, health, ingestion, document management). Phase 2 builds the pipeline workers, retrieval, reasoning, query endpoint, and containerisation. Each task builds on the previous and includes property-based tests (fast-check) for the 37 correctness properties defined in the design.

## Tasks

### Phase 1 — Foundation

- [x] 1. Set up project structure and dependencies
  - [x] 1.1 Initialise `api/` directory with `package.json` including all dependencies: fastify, @fastify/multipart, bullmq, ioredis, pg, pgvector, openai, @anthropic-ai/sdk, @aws-sdk/client-s3, playwright, tiktoken, dotenv, fast-check (dev), vitest (dev)
    - Create `api/src/` directory structure: config/, db/, db/migrations/, db/queries/, queue/, routes/, workers/, services/
    - Create `api/vitest.config.js` with test file patterns for unit and property tests
    - Create `api/src/app.js` Fastify app skeleton with error handler enforcing `{ error, code }` response shape
    - _Requirements: 21.1, 21.2, 24.1_

- [ ] 2. Implement environment configuration
  - [ ] 2.1 Create `api/src/config/env.js`
    - Validate all required env vars on import: DATABASE_URL, REDIS_URL, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET, OPENAI_API_KEY, ANTHROPIC_API_KEY, UNSTRUCTURED_API_KEY, PORT, NODE_ENV
    - Throw error listing all missing variables if any are absent
    - Return frozen config object
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 2.2 Write property test for environment validation (Property 1)
    - **Property 1: Environment validation rejects incomplete config**
    - For any subset of required env vars missing at least one, `validateEnv()` throws and the error message contains every missing variable name
    - **Validates: Requirements 1.1, 1.2**

- [ ] 3. Implement database initialisation
  - [ ] 3.1 Create `api/src/db/migrations/001_initial.sql`
    - CREATE EXTENSION IF NOT EXISTS vector and uuid-ossp
    - CREATE TABLE documents, chunks, sessions with all columns, constraints, defaults
    - CREATE INDEX chunks_embedding_idx (HNSW using vector_cosine_ops)
    - CREATE UNIQUE INDEX chunks_hash_idx on chunk_hash
    - CREATE INDEX chunks_tenant_doc_idx on (tenant_id, document_id)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 3.2 Create `api/src/db/client.js`
    - Export pg Pool connected to DATABASE_URL
    - `initialize()` function that reads and executes 001_initial.sql
    - `healthCheck()` function that runs SELECT 1
    - _Requirements: 2.1_

  - [ ] 3.3 Create `api/src/db/queries/documents.js`
    - Insert, findById, findAll (with status/source_type/limit/offset filters), delete, updateStatus, updateMetadata queries
    - All queries enforce tenant_id scoping
    - _Requirements: 3.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 7.1_

  - [ ] 3.4 Create `api/src/db/queries/chunks.js`
    - Insert batch, findByDocumentId, deleteByDocumentId, countByDocumentId queries
    - _Requirements: 10.5, 6.1_

  - [ ] 3.5 Create `api/src/db/queries/sessions.js`
    - Insert, findById, appendHistory queries
    - _Requirements: 19.1, 19.2, 19.4_

- [ ] 4. Implement queue client and event constants
  - [ ] 4.1 Create `api/src/queue/client.js`
    - IORedis connection from REDIS_URL
    - BullMQ Queue instance for pipeline events
    - `healthCheck()` function that runs PING
    - _Requirements: 23.1_

  - [ ] 4.2 Create `api/src/queue/events.js`
    - Export EVENTS object with all constants: CONTENT_UPLOADED, CONTENT_EXTRACTED, CONTENT_TRANSFORMED, CHUNKS_CREATED, EMBEDDINGS_CREATED, INDEX_COMPLETE, PIPELINE_FAILED
    - Export `buildPayload(documentId, tenantId, stage, error?)` helper that constructs event payloads with document_id, tenant_id, timestamp, stage
    - _Requirements: 23.1, 23.2, 23.3_

  - [ ]* 4.3 Write property test for queue event payloads (Property 36)
    - **Property 36: Queue event payload completeness**
    - For any enqueued pipeline event, payload contains document_id, tenant_id, timestamp, stage. PIPELINE_FAILED events additionally contain error.
    - **Validates: Requirements 23.2, 23.3**

- [ ] 5. Implement S3 artifact storage service
  - [ ] 5.1 Create `api/src/services/s3Service.js`
    - `upload(tenantId, documentId, stage, body, contentType)` — uploads to `{tenantId}/{documentId}/{stage}`
    - `download(tenantId, documentId, stage)` — returns Buffer
    - `deleteAll(tenantId, documentId)` — deletes all objects under prefix
    - `healthCheck()` — HeadBucket, returns true/false
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ]* 5.2 Write property test for S3 artifact path structure (Property 3)
    - **Property 3: S3 artifact path structure**
    - For any tenant_id, document_id, stage, the S3 key is `{tenant_id}/{document_id}/{stage}`. Upload then download returns original content.
    - **Validates: Requirements 13.1, 13.2, 3.4**

  - [ ]* 5.3 Write property test for S3 deleteAll (Property 4)
    - **Property 4: S3 deleteAll removes all artifacts**
    - For any tenant_id and document_id with stored artifacts, deleteAll leaves no objects under that prefix.
    - **Validates: Requirements 13.3, 7.2**

- [ ] 6. Implement health check endpoint
  - [ ] 6.1 Create `api/src/routes/health.js`
    - GET /health — checks Postgres, Redis, S3 health
    - Returns `{ status, postgres, redis, s3 }` with "ok" or "error" per dependency
    - Overall status reflects degraded state if any dependency is down
    - _Requirements: 20.1, 20.2, 20.3_

  - [ ]* 6.2 Write property test for health check response shape (Property 33)
    - **Property 33: Health check response shape**
    - For any health check request, response contains status, postgres, redis, s3 fields. When a dependency is unreachable, its field is "error" and overall status reflects degraded state.
    - **Validates: Requirements 20.1, 20.3**

- [ ] 7. Implement file ingestion endpoint
  - [ ] 7.1 Create `api/src/routes/ingest.js` — POST /research360/ingest/file
    - Accept multipart/form-data with file, optional title, optional tenant_id (default "ethikslabs")
    - Validate file type is PDF, DOCX, or PPTX (case-insensitive); return 400 with INVALID_FILE_TYPE if not
    - Upload raw file to S3 at `{tenant_id}/{document_id}/original`
    - Insert document record with source_type "document", status "PENDING", file_name, file_type, s3_key
    - Enqueue CONTENT_UPLOADED job via BullMQ
    - Return `{ document_id, status: "PENDING", message }` immediately
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [ ] 7.2 Create `api/src/routes/ingest.js` — POST /research360/ingest/url
    - Accept JSON with url (required), optional title, optional tenant_id (default "ethikslabs")
    - Detect YouTube URL patterns (youtube.com/watch, youtu.be, youtube.com/shorts) → source_type "youtube"; all others → "url"
    - Insert document record with detected source_type, status "PENDING", source_url
    - Enqueue CONTENT_UPLOADED job with url in metadata
    - Return `{ document_id, status: "PENDING", source_type, message }` immediately
    - Return 400 with MISSING_URL if url field is missing or empty
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ]* 7.3 Write property test for file type validation (Property 2)
    - **Property 2: File type validation accepts only PDF, DOCX, PPTX**
    - For any file type string, ingestion accepts iff type (case-insensitive) is PDF, DOCX, or PPTX. Others rejected with 400.
    - **Validates: Requirements 3.2, 3.3**

  - [ ]* 7.4 Write property test for YouTube URL detection (Property 5)
    - **Property 5: YouTube URL detection**
    - For any URL string, source_type is "youtube" iff URL matches YouTube pattern. All others produce "url".
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 7.5 Write property test for ingestion response fields (Property 6)
    - **Property 6: Ingestion response contains required fields**
    - For any valid ingestion request, response contains document_id (UUID), status "PENDING", message. URL responses additionally contain source_type.
    - **Validates: Requirements 3.1, 4.1**

  - [ ]* 7.6 Write property test for tenant_id default (Property 7)
    - **Property 7: Tenant ID defaults to "ethikslabs"**
    - For any ingestion request without tenant_id, document record has tenant_id "ethikslabs". If provided, uses that value.
    - **Validates: Requirements 3.9**

- [ ] 8. Implement document management endpoints
  - [ ] 8.1 Create `api/src/routes/documents.js` — GET /research360/documents
    - Return `{ documents[], total }` with filtering by status, source_type and pagination via limit (default 50), offset
    - Each document includes id, title, source_type, status, file_name, created_at
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ] 8.2 Create `api/src/routes/documents.js` — GET /research360/documents/:id
    - Return document with id, title, source_type, status, metadata, created_at, chunk_count
    - Return 404 with DOCUMENT_NOT_FOUND if not found
    - _Requirements: 6.1, 6.2_

  - [ ] 8.3 Create `api/src/routes/documents.js` — DELETE /research360/documents/:id
    - Delete document record (CASCADE deletes chunks), delete S3 artifacts via deleteAll
    - Return 204 on success, 404 if not found
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]* 8.4 Write property test for document list filtering (Property 8)
    - **Property 8: Document list filtering**
    - For any filter (status or source_type), all returned documents match the filter. Total reflects filtered count.
    - **Validates: Requirements 5.2, 5.3**

  - [ ]* 8.5 Write property test for document list pagination (Property 9)
    - **Property 9: Document list pagination**
    - For any limit and offset, returns at most limit documents corresponding to the correct slice.
    - **Validates: Requirements 5.4**

  - [ ]* 8.6 Write property test for document list response shape (Property 10)
    - **Property 10: Document list response shape**
    - For any document in list response, object contains id, title, source_type, status, file_name, created_at. Response has documents array and total integer.
    - **Validates: Requirements 5.1, 5.6**

  - [ ]* 8.7 Write property test for non-existent resource 404 (Property 11)
    - **Property 11: Non-existent resource returns 404**
    - For any UUID not corresponding to an existing document or session, GET/DELETE returns 404 with standard error format.
    - **Validates: Requirements 6.2, 7.4, 19.5**

  - [ ]* 8.8 Write property test for document deletion cascade (Property 12)
    - **Property 12: Document deletion cascades to chunks**
    - For any document with chunks, after deletion neither document nor chunks exist in the database.
    - **Validates: Requirements 7.1**

  - [ ]* 8.9 Write property test for error response format (Property 34)
    - **Property 34: Error response format consistency**
    - For any error response from any endpoint, body contains error (string) and code (string). HTTP status is 400/404/500 as appropriate.
    - **Validates: Requirements 21.1, 21.2**

- [ ] 9. Phase 1 Checkpoint
  - Ensure all Phase 1 tests pass. Verify: env validation, database migration, queue connection, S3 operations, health check, file/URL ingestion, document CRUD all work correctly. Ask the user if questions arise.

### Phase 2 — Pipeline & Query

- [ ] 10. Implement extraction worker and service
  - [ ] 10.1 Create `api/src/services/extractionService.js`
    - `extract(document)` dispatches by source_type:
      - "document" → download from S3, send to Unstructured.io API, return text
      - "url" → Playwright + Readability, return article text
      - "youtube" → yt-dlp + Whisper (local binary); if local Whisper not available, fallback to OpenAI Whisper API (`openai.audio.transcriptions.create()`)
    - Log structured JSON with document_id and stage for all operations
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ] 10.2 Create `api/src/workers/extractionWorker.js`
    - BullMQ Worker consuming CONTENT_UPLOADED events
    - Retry config: attempts=3, backoff [1000, 5000, 30000]
    - On success: save extracted text to S3 at `{tenant_id}/{document_id}/extracted`, update status to EXTRACTED, enqueue CONTENT_EXTRACTED
    - On final failure: update status to FAILED, store error + failed_stage in metadata, enqueue PIPELINE_FAILED
    - All operations log structured JSON
    - _Requirements: 8.5, 8.6, 8.7, 12.1, 12.2, 12.3, 12.4, 22.1, 22.5_

  - [ ]* 10.3 Write property test for extraction dispatch (Property 37)
    - **Property 37: Extraction dispatches by source type**
    - For any document with a given source_type, extraction invokes the correct method: Unstructured.io for "document", Playwright+Readability for "url", yt-dlp+Whisper for "youtube".
    - **Validates: Requirements 8.1**

- [ ] 11. Implement transform worker and service
  - [ ] 11.1 Create `api/src/services/transformService.js`
    - `transform(rawText)` returns `{ text, boundaries }`
    - Strip repeated whitespace and control characters
    - Remove filler words (um, uh, "you know") as standalone tokens
    - Reconstruct broken paragraphs (join lines not ending with punctuation)
    - Normalise unicode to NFC form
    - Identify semantic boundaries (double newlines, headers, topic shifts)
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6_

  - [ ] 11.2 Create `api/src/workers/transformWorker.js`
    - BullMQ Worker consuming CONTENT_EXTRACTED events
    - Download extracted text from S3, run transform, save to S3 at `{tenant_id}/{document_id}/transformed`
    - Retry config: attempts=3, backoff [1000, 5000, 30000]
    - On success: update status to TRANSFORMED, enqueue CONTENT_TRANSFORMED
    - On final failure: update status to FAILED, store error + failed_stage in metadata
    - _Requirements: 9.1, 9.7, 9.8, 9.9, 12.1, 12.2, 12.3_

  - [ ]* 11.3 Write property test for whitespace stripping (Property 13)
    - **Property 13: Transform strips whitespace and control characters**
    - For any input text, output contains no consecutive whitespace (beyond single spaces and paragraph breaks) or control characters.
    - **Validates: Requirements 9.2**

  - [ ]* 11.4 Write property test for filler word removal (Property 14)
    - **Property 14: Transform removes filler words**
    - For any input text containing standalone filler words (um, uh, "you know"), output does not contain those filler words as standalone tokens.
    - **Validates: Requirements 9.3**

  - [ ]* 11.5 Write property test for unicode normalisation (Property 15)
    - **Property 15: Transform normalises unicode**
    - For any input text, output is in NFC-normalized form: `output === output.normalize('NFC')`.
    - **Validates: Requirements 9.5**

- [ ] 12. Implement chunk worker and service
  - [ ] 12.1 Create `api/src/services/chunkService.js`
    - `chunk(text, boundaries)` returns `Array<{ chunk_text, chunk_index, chunk_hash, token_count }>`
    - Target 700 tokens/chunk, 15% overlap, respect semantic boundaries
    - Use tiktoken for token counting, crypto.createHash('sha256') for hashing
    - _Requirements: 10.2, 10.3, 10.4, 10.5_

  - [ ] 12.2 Create `api/src/workers/chunkWorker.js`
    - BullMQ Worker consuming CONTENT_TRANSFORMED events
    - Download transformed text from S3, run chunk service, insert chunks into DB
    - Retry config: attempts=3, backoff [1000, 5000, 30000]
    - On success: update status to CHUNKED, enqueue CHUNKS_CREATED
    - On final failure: update status to FAILED, store error + failed_stage in metadata
    - _Requirements: 10.1, 10.5, 10.6, 10.7, 12.1, 12.2, 12.3_

  - [ ]* 12.3 Write property test for chunk token count consistency (Property 16)
    - **Property 16: Chunk token count consistency**
    - For any chunk, token_count equals the result of counting tokens in chunk_text using tiktoken with the same encoding.
    - **Validates: Requirements 10.3**

  - [ ]* 12.4 Write property test for chunk size bounds (Property 17)
    - **Property 17: Chunk size bounds**
    - For any text producing multiple chunks, each chunk (except possibly the last) has token count within 400–1000 tokens. Consecutive chunks share ~15% overlap.
    - **Validates: Requirements 10.2**

  - [ ]* 12.5 Write property test for chunk hash (Property 18)
    - **Property 18: Chunk hash is SHA-256 of chunk text**
    - For any chunk, chunk_hash equals SHA-256 hex digest of chunk_text.
    - **Validates: Requirements 10.5**

- [ ] 13. Implement embedding worker and service
  - [ ] 13.1 Create `api/src/services/embeddingService.js`
    - `embedTexts(texts)` — batches up to 100 texts per OpenAI API call, returns Array<number[]> (3072-dim)
    - `embedText(text)` — single text embedding
    - Log latency and token usage per batch
    - _Requirements: 11.1, 11.2, 11.6_

  - [ ] 13.2 Create `api/src/workers/embeddingWorker.js`
    - BullMQ Worker consuming CHUNKS_CREATED events
    - Load chunks where embedding IS NULL, check chunk_hash for dedup, batch into groups of 100
    - Call OpenAI text-embedding-3-large, store 3072-dim vectors in chunks.embedding
    - Retry config: attempts=3, backoff [1000, 5000, 30000]
    - On success: update status to INDEXED, enqueue INDEX_COMPLETE
    - On final failure: update status to FAILED, store error + failed_stage in metadata
    - Log document_id, chunk_count, embedding_latency_ms, token_usage
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 12.1, 12.2, 12.3, 22.2_

  - [ ]* 13.3 Write property test for embedding batching (Property 19)
    - **Property 19: Embedding batching respects max size**
    - For any N chunks, embedding service produces ceil(N/100) batches, each containing at most 100 chunks.
    - **Validates: Requirements 11.2**

  - [ ]* 13.4 Write property test for embedding deduplication (Property 20)
    - **Property 20: Embedding deduplication by hash**
    - For any set of chunks where some already have embeddings, the worker skips those and only calls OpenAI for chunks without embeddings.
    - **Validates: Requirements 11.3**

- [ ] 14. Checkpoint — Pipeline workers
  - Ensure all pipeline worker tests pass. Verify extraction dispatch, transform normalisation, chunking, and embedding batching/dedup all work correctly. Ask the user if questions arise.

- [ ] 15. Implement worker status transition and failure properties
  - [ ]* 15.1 Write property test for worker failure sets FAILED (Property 21)
    - **Property 21: Worker failure after retries sets FAILED status**
    - For any worker failing all 3 retries, document status is FAILED and metadata contains error message and failed stage.
    - **Validates: Requirements 12.3, 8.7, 9.9, 10.7, 11.7**

  - [ ]* 15.2 Write property test for worker success transitions (Property 22)
    - **Property 22: Worker success transitions status correctly**
    - For any worker completing successfully, document status transitions to correct next state and next queue event is enqueued.
    - **Validates: Requirements 8.6, 9.8, 10.6, 11.5**

  - [ ]* 15.3 Write property test for structured log format (Property 35)
    - **Property 35: Structured log format**
    - For any log entry, it is valid JSON. Pipeline logs contain timestamp, document_id, stage. Embedding logs additionally contain chunk_count, embedding_latency_ms, token_usage.
    - **Validates: Requirements 22.1, 22.2, 22.3, 22.4, 22.5**

- [ ] 16. Implement retrieval service
  - [ ] 16.1 Create `api/src/services/retrievalService.js`
    - `retrieve({ query, tenantId, k, filters })` — embed query via embeddingService, run pgvector cosine similarity search (`1 - (embedding <=> queryVector)`), enforce tenant_id filter, apply optional source_type/document_id filters, return top-k chunks with chunk_id, chunk_text, chunk_index, metadata, relevance_score, document_id, document_title, source_type, source_url
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

  - [ ]* 16.2 Write property test for retrieval ordering (Property 23)
    - **Property 23: Retrieval results ordered by descending relevance**
    - For any query returning multiple chunks, results are ordered by descending relevance_score.
    - **Validates: Requirements 14.2**

  - [ ]* 16.3 Write property test for tenant isolation (Property 24)
    - **Property 24: Retrieval enforces tenant isolation**
    - For any query with a tenant_id, all returned chunks belong to that tenant. No cross-tenant leakage.
    - **Validates: Requirements 14.3**

  - [ ]* 16.4 Write property test for metadata filters (Property 25)
    - **Property 25: Retrieval applies metadata filters**
    - For any query with filters (source_type, document_id), all returned chunks match every specified filter.
    - **Validates: Requirements 14.4**

  - [ ]* 16.5 Write property test for top-k by complexity (Property 26)
    - **Property 26: Retrieval top-k matches complexity mode**
    - For any complexity mode, retrieval returns at most k chunks: 3 for simple, 10 for detailed, 20 for deep.
    - **Validates: Requirements 14.5, 17.1, 17.2, 17.3**

- [ ] 17. Implement persona layer and reasoning service
  - [ ] 17.1 Create `api/src/config/personas.js`
    - Export PERSONAS object with "strategist" and "analyst" prompt strings
    - Strategist: high-level synthesis, executive tone, implications and recommendations
    - Analyst: structured breakdown, evidence citation, precise language
    - _Requirements: 16.1, 16.2_

  - [ ] 17.2 Create `api/src/services/reasoningService.js`
    - `reason({ query, chunks, persona, complexity, history })` — look up persona prompt, get complexity config (k + style), assemble system prompt with persona + style + "reason from context only" + "3 suggestions", build messages with history (last 6 turns) + context + query, call Claude claude-sonnet-4-6, parse JSON response `{ answer, suggestions }`, return `{ answer, persona, complexity, sources, suggestions }`
    - Default persona: "strategist", default complexity: "detailed"
    - Instruct Claude to state clearly if context is insufficient
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 16.3, 17.1, 17.2, 17.3, 17.4_

  - [ ]* 17.3 Write property test for persona prompt selection (Property 27)
    - **Property 27: Persona prompt selection**
    - For any persona value ("strategist" or "analyst"), the assembled prompt contains the corresponding persona text. Persona affects only the system prompt.
    - **Validates: Requirements 16.1, 16.2**

  - [ ]* 17.4 Write property test for 3 suggestions (Property 28)
    - **Property 28: Reasoning response contains exactly 3 suggestions**
    - For any successful reasoning call, response contains a suggestions array with exactly 3 string elements.
    - **Validates: Requirements 15.3, 18.4**

- [ ] 18. Implement query endpoint and session management
  - [ ] 18.1 Create `api/src/routes/query.js` — POST /research360/query
    - Accept JSON: query (required), tenant_id (default "ethikslabs"), persona (default "strategist"), complexity (default "detailed"), session_id (optional), filters (optional)
    - Return 400 with MISSING_QUERY if query is missing/empty
    - Load or create session; embed query; retrieve top-k chunks; run reasoning; save turn to session history
    - Return `{ answer, persona, complexity, session_id, sources[], suggestions[] }`
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9_

  - [ ] 18.2 Create `api/src/routes/query.js` — GET /research360/sessions/:id
    - Return `{ session_id, history[] }` or 404 with SESSION_NOT_FOUND
    - _Requirements: 19.4, 19.5_

  - [ ]* 18.3 Write property test for query response shape (Property 29)
    - **Property 29: Query response shape**
    - For any successful query, response contains answer (string), persona (string), complexity (string), session_id (UUID), sources (array), suggestions (array). Each source has document_id, document_title, source_type, source_url, chunk_id, chunk_text, chunk_index, relevance_score.
    - **Validates: Requirements 18.2, 18.3**

  - [ ]* 18.4 Write property test for session history growth (Property 30)
    - **Property 30: Session history grows by one turn per query**
    - For any session, after a query, history contains one additional user entry and one assistant entry. Each has role, content, timestamp. Assistant entries have persona.
    - **Validates: Requirements 19.2**

  - [ ]* 18.5 Write property test for session history window (Property 31)
    - **Property 31: Session history window is last 6 turns**
    - For any session with N turns, reasoning prompt includes at most last 6 turns. Fewer than 6 includes all.
    - **Validates: Requirements 19.3**

  - [ ]* 18.6 Write property test for new session empty history (Property 32)
    - **Property 32: New session starts with empty history**
    - For any newly created session, history is an empty array and id is a valid UUID.
    - **Validates: Requirements 19.1**

- [ ] 19. Wire app.js — register all routes and start workers
  - Register all route plugins: health, ingest, documents, query/sessions
  - Initialise database (run migrations), start all BullMQ workers (extraction, transform, chunk, embedding) in the same process
  - Start Fastify server on configured PORT
  - _Requirements: 1.3, 24.2_

- [ ] 20. Checkpoint — Query path and sessions
  - Ensure all Phase 2 tests pass. Verify retrieval, reasoning, query endpoint, session management, and all property tests. Ask the user if questions arise.

- [ ] 21. Implement Docker containerisation
  - [ ] 21.1 Create `api/Dockerfile`
    - Multi-stage build using Node.js 20
    - Install production dependencies, copy source
    - Run Fastify server and all BullMQ workers in the same process
    - _Requirements: 24.1, 24.2_

  - [ ] 21.2 Create `api/.env.example`
    - Document all required environment variables: DATABASE_URL, REDIS_URL, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET, OPENAI_API_KEY, ANTHROPIC_API_KEY, UNSTRUCTURED_API_KEY, PORT, NODE_ENV
    - _Requirements: 24.3_

- [ ] 22. Final checkpoint — Full integration
  - Ensure all tests pass (unit + property). Verify the complete flow: ingestion → extraction → transform → chunk → embedding → retrieval → reasoning → query response. Verify Docker builds. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints at tasks 9, 14, 20, and 22 ensure incremental validation
- Property tests validate the 37 correctness properties from the design using fast-check
- All errors return `{ "error": "message", "code": "ERROR_CODE" }` (Requirement 21)
- All pipeline stages log structured JSON (Requirement 22)
- All workers retry max 3 times with exponential backoff: 1s, 5s, 30s (Requirement 12)
- tenant_id defaults to "ethikslabs" everywhere
- Phase 2 must not begin until Phase 1 (task 9 checkpoint) is confirmed working
