# Requirements Document

## Introduction

Research360 API is the backend knowledge ingestion, retrieval, and reasoning service for the ethikslabs platform. It accepts documents (PDF, DOCX, PPTX), web URLs, and YouTube URLs, processes them through a four-stage pipeline (extraction → transformation → chunking → embedding), stores the resulting vector embeddings in pgvector, and exposes a query endpoint that retrieves relevant chunks and runs Claude-powered reasoning with persona and complexity controls. The API is built on Fastify with BullMQ for pipeline orchestration, Postgres+pgvector for storage, S3 for raw artifacts, OpenAI for embeddings, and Anthropic Claude for reasoning.

## Glossary

- **API**: The Fastify HTTP server exposing all Research360 endpoints
- **Pipeline**: The BullMQ-based asynchronous processing chain that converts raw content into indexed vector embeddings
- **Extraction_Worker**: The pipeline stage that converts raw source material into plain text using Unstructured.io, Playwright, or yt-dlp+Whisper depending on source type
- **Transform_Worker**: The pipeline stage that normalises extracted text by removing filler words, reconstructing broken paragraphs, normalising whitespace/unicode, and identifying semantic boundaries
- **Chunk_Worker**: The pipeline stage that segments transformed text into overlapping token-bounded chunks respecting semantic boundaries
- **Embedding_Worker**: The pipeline stage that generates OpenAI text-embedding-3-large vectors for each chunk and stores them in pgvector
- **Retrieval_Service**: The component that embeds a user query and performs cosine similarity search against pgvector to return top-k relevant chunks
- **Reasoning_Service**: The component that assembles a prompt from persona, retrieved chunks, conversation history, and user query, then calls Claude to produce an answer, sources, and suggestions
- **Document**: A record in the documents table representing an ingested source (file upload, web URL, or YouTube URL)
- **Chunk**: A segment of processed text stored in the chunks table with its vector embedding
- **Session**: A conversation context stored in the sessions table containing turn history
- **Persona**: A system prompt modifier that changes the reasoning style (strategist or analyst)
- **Complexity_Mode**: A query parameter (simple, detailed, deep) that controls retrieval depth (top-k) and reasoning style
- **Tenant_ID**: A text identifier scoping all data access; defaults to "ethikslabs"
- **S3_Artifact**: A raw file stored in S3 at the path `{tenant_id}/{document_id}/{stage}`
- **Queue_Event**: A BullMQ job type representing a pipeline stage transition (e.g., CONTENT_UPLOADED, CONTENT_EXTRACTED)

## Requirements

### Requirement 1: Environment Configuration and Startup Validation

**User Story:** As a platform operator, I want the API to validate all required environment variables on startup, so that misconfigured deployments fail fast with clear error messages.

#### Acceptance Criteria

1. WHEN the API starts, THE API SHALL validate that all required environment variables are present: DATABASE_URL, REDIS_URL, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET, OPENAI_API_KEY, ANTHROPIC_API_KEY, UNSTRUCTURED_API_KEY, PORT, NODE_ENV
2. IF any required environment variable is missing, THEN THE API SHALL terminate the process and log a message identifying each missing variable
3. WHEN all environment variables are valid, THE API SHALL start the Fastify server on the configured PORT

### Requirement 2: Database Initialization

**User Story:** As a platform operator, I want the database schema to be created automatically on startup, so that the API is ready to use without manual migration steps.

#### Acceptance Criteria

1. WHEN the API starts and connects to Postgres, THE API SHALL execute the initial migration creating the documents, chunks, and sessions tables with all columns, constraints, and indexes as defined in the schema
2. THE API SHALL create the pgvector extension and uuid-ossp extension if they do not already exist
3. THE API SHALL create an HNSW index on the chunks.embedding column using vector_cosine_ops
4. THE API SHALL create a unique index on chunks.chunk_hash for deduplication
5. THE API SHALL create a composite index on chunks(tenant_id, document_id) for filtered queries

### Requirement 3: File Ingestion Endpoint

**User Story:** As a researcher, I want to upload PDF, DOCX, and PPTX files for ingestion, so that their content becomes queryable in Research360.

#### Acceptance Criteria

1. WHEN a multipart/form-data POST request is received at /research360/ingest/file with a valid file, THE API SHALL accept the file and return a JSON response containing document_id, status "PENDING", and a confirmation message
2. THE API SHALL validate that the uploaded file type is one of PDF, DOCX, or PPTX
3. IF the uploaded file type is not PDF, DOCX, or PPTX, THEN THE API SHALL return a 400 error with a descriptive error message and error code
4. WHEN a valid file is received, THE API SHALL upload the raw file to S3 at the path {tenant_id}/{document_id}/original
5. WHEN a valid file is received, THE API SHALL insert a document record in Postgres with source_type "document", status "PENDING", the file_name, file_type, and s3_key
6. WHEN the document record is created, THE API SHALL enqueue a CONTENT_UPLOADED job in BullMQ containing the document_id and tenant_id
7. THE API SHALL return the response immediately without waiting for pipeline processing to complete
8. WHEN the request includes an optional title field, THE API SHALL store the title in the document record
9. WHEN the request includes an optional tenant_id field, THE API SHALL use that tenant_id; otherwise THE API SHALL default to "ethikslabs"

### Requirement 4: URL Ingestion Endpoint

**User Story:** As a researcher, I want to submit web page URLs and YouTube URLs for ingestion, so that their content becomes queryable in Research360.

#### Acceptance Criteria

1. WHEN a JSON POST request is received at /research360/ingest/url with a valid url field, THE API SHALL return a JSON response containing document_id, status "PENDING", source_type, and a confirmation message
2. WHEN the submitted URL matches a YouTube URL pattern, THE API SHALL set source_type to "youtube"
3. WHEN the submitted URL does not match a YouTube URL pattern, THE API SHALL set source_type to "url"
4. WHEN a valid URL is received, THE API SHALL insert a document record in Postgres with the detected source_type, status "PENDING", and the url stored in source_url
5. WHEN the document record is created, THE API SHALL enqueue a CONTENT_UPLOADED job in BullMQ containing the document_id, tenant_id, and url in metadata
6. THE API SHALL return the response immediately without waiting for pipeline processing to complete
7. IF the url field is missing or empty, THEN THE API SHALL return a 400 error with a descriptive error message

### Requirement 5: Document Listing Endpoint

**User Story:** As a researcher, I want to list all ingested documents with filtering and pagination, so that I can browse and monitor my knowledge base.

#### Acceptance Criteria

1. WHEN a GET request is received at /research360/documents, THE API SHALL return a JSON response containing a documents array and a total count
2. WHEN the request includes a status query parameter, THE API SHALL filter documents by that status value
3. WHEN the request includes a source_type query parameter, THE API SHALL filter documents by that source_type value
4. WHEN the request includes limit and offset query parameters, THE API SHALL paginate results accordingly
5. WHEN no limit is specified, THE API SHALL default to returning 50 documents
6. THE API SHALL return each document with id, title, source_type, status, file_name, and created_at fields

### Requirement 6: Document Detail Endpoint

**User Story:** As a researcher, I want to view the status and metadata of a specific document, so that I can track its processing progress.

#### Acceptance Criteria

1. WHEN a GET request is received at /research360/documents/:id with a valid document UUID, THE API SHALL return the document record including id, title, source_type, status, metadata, created_at, and the count of associated chunks
2. IF the document_id does not exist, THEN THE API SHALL return a 404 error with a descriptive error message

### Requirement 7: Document Deletion Endpoint

**User Story:** As a researcher, I want to delete a document and all its associated data, so that I can remove outdated or incorrect content from my knowledge base.

#### Acceptance Criteria

1. WHEN a DELETE request is received at /research360/documents/:id with a valid document UUID, THE API SHALL delete the document record and all associated chunks from Postgres
2. WHEN deleting a document, THE API SHALL delete all S3 artifacts stored under the path {tenant_id}/{document_id}/
3. WHEN deletion is successful, THE API SHALL return HTTP status 204 with no body
4. IF the document_id does not exist, THEN THE API SHALL return a 404 error with a descriptive error message

### Requirement 8: Extraction Worker

**User Story:** As a platform operator, I want raw content to be automatically extracted from uploaded files, web pages, and YouTube videos, so that the text is available for downstream processing.

#### Acceptance Criteria

1. WHEN a CONTENT_UPLOADED job is received, THE Extraction_Worker SHALL determine the extraction method based on the document's source_type
2. WHEN source_type is "document", THE Extraction_Worker SHALL download the file from S3 and send it to the Unstructured.io API to extract raw text
3. WHEN source_type is "url", THE Extraction_Worker SHALL launch Playwright, navigate to the URL, and extract article text using Readability
4. WHEN source_type is "youtube", THE Extraction_Worker SHALL run yt-dlp to download the audio and run Whisper to transcribe the audio into text
5. WHEN extraction succeeds, THE Extraction_Worker SHALL save the extracted text to S3 at the path {tenant_id}/{document_id}/extracted
6. WHEN extraction succeeds, THE Extraction_Worker SHALL update the document status to "EXTRACTED" and enqueue a CONTENT_EXTRACTED job
7. IF extraction fails after 3 retry attempts, THEN THE Extraction_Worker SHALL update the document status to "FAILED" and store the error message in the document metadata

### Requirement 9: Transform Worker

**User Story:** As a platform operator, I want extracted text to be normalised and cleaned, so that downstream chunking produces high-quality segments.

#### Acceptance Criteria

1. WHEN a CONTENT_EXTRACTED job is received, THE Transform_Worker SHALL download the extracted text from S3
2. THE Transform_Worker SHALL strip repeated whitespace and control characters from the text
3. THE Transform_Worker SHALL remove filler words from transcripts (um, uh, you know)
4. THE Transform_Worker SHALL reconstruct broken paragraphs by joining lines that do not end with punctuation
5. THE Transform_Worker SHALL normalise unicode characters in the text
6. THE Transform_Worker SHALL identify semantic boundaries such as double newlines, headers, and topic shifts
7. WHEN transformation succeeds, THE Transform_Worker SHALL save the transformed text to S3 at the path {tenant_id}/{document_id}/transformed
8. WHEN transformation succeeds, THE Transform_Worker SHALL update the document status to "TRANSFORMED" and enqueue a CONTENT_TRANSFORMED job
9. IF transformation fails after 3 retry attempts, THEN THE Transform_Worker SHALL update the document status to "FAILED" and store the error message in the document metadata

### Requirement 10: Chunk Worker

**User Story:** As a platform operator, I want transformed text to be segmented into overlapping chunks, so that each chunk is appropriately sized for embedding and retrieval.

#### Acceptance Criteria

1. WHEN a CONTENT_TRANSFORMED job is received, THE Chunk_Worker SHALL download the transformed text from S3
2. THE Chunk_Worker SHALL segment the text into chunks targeting 700 tokens per chunk with 15% overlap between consecutive chunks
3. THE Chunk_Worker SHALL use tiktoken to count tokens accurately for each chunk
4. THE Chunk_Worker SHALL respect semantic boundaries and not split text mid-paragraph
5. WHEN chunking succeeds, THE Chunk_Worker SHALL insert each chunk into the chunks table with chunk_index, chunk_text, chunk_hash (SHA-256 of chunk_text), and token_count
6. WHEN chunking succeeds, THE Chunk_Worker SHALL update the document status to "CHUNKED" and enqueue a CHUNKS_CREATED job
7. IF chunking fails after 3 retry attempts, THEN THE Chunk_Worker SHALL update the document status to "FAILED" and store the error message in the document metadata

### Requirement 11: Embedding Worker

**User Story:** As a platform operator, I want chunks to be embedded as vectors, so that they are searchable via semantic similarity.

#### Acceptance Criteria

1. WHEN a CHUNKS_CREATED job is received, THE Embedding_Worker SHALL load all chunks for the document_id where the embedding column is NULL
2. THE Embedding_Worker SHALL batch chunks into groups of 100 for the OpenAI API call
3. THE Embedding_Worker SHALL check each chunk's chunk_hash against existing embeddings and skip chunks that already have an embedding (deduplication)
4. THE Embedding_Worker SHALL call the OpenAI text-embedding-3-large API for each batch and store the resulting 3072-dimension vectors in the chunks.embedding column
5. WHEN all chunks are embedded, THE Embedding_Worker SHALL update the document status to "INDEXED" and enqueue an INDEX_COMPLETE job
6. THE Embedding_Worker SHALL log the document_id, chunk_count, embedding_latency_ms, and token_usage for each batch
7. IF embedding fails after 3 retry attempts, THEN THE Embedding_Worker SHALL update the document status to "FAILED" and store the error message in the document metadata

### Requirement 12: Worker Retry and Error Handling

**User Story:** As a platform operator, I want failed pipeline jobs to be retried with exponential backoff, so that transient failures are handled gracefully.

#### Acceptance Criteria

1. THE Pipeline SHALL configure all BullMQ workers with a maximum of 3 retry attempts
2. THE Pipeline SHALL use exponential backoff delays of 1 second, 5 seconds, and 30 seconds for the 1st, 2nd, and 3rd retry attempts respectively
3. WHEN a job fails after all retry attempts are exhausted, THE Pipeline SHALL update the document status to "FAILED" and store the error message and failed stage in the document metadata
4. THE Pipeline SHALL log all errors with the document_id and pipeline stage in structured JSON format

### Requirement 13: S3 Artifact Storage Service

**User Story:** As a platform operator, I want raw and processed artifacts stored in S3 with a consistent path structure, so that pipeline stages can reliably read and write intermediate results.

#### Acceptance Criteria

1. THE S3_Service SHALL upload files to S3 at the path {tenant_id}/{document_id}/{stage} where stage is one of: original, extracted, transformed, transcript
2. THE S3_Service SHALL download files from S3 given a tenant_id, document_id, and stage
3. THE S3_Service SHALL delete all artifacts for a given tenant_id and document_id when a document is deleted
4. THE S3_Service SHALL use the S3_BUCKET environment variable as the target bucket

### Requirement 14: Retrieval Service

**User Story:** As a researcher, I want to search my knowledge base using natural language queries, so that I receive the most semantically relevant chunks.

#### Acceptance Criteria

1. WHEN a query is submitted, THE Retrieval_Service SHALL embed the query text using the OpenAI text-embedding-3-large model
2. THE Retrieval_Service SHALL perform a cosine similarity search against the chunks table using pgvector, ordered by descending relevance score
3. THE Retrieval_Service SHALL enforce a tenant_id filter on every query
4. WHEN metadata filters are provided (source_type, document_id), THE Retrieval_Service SHALL apply those filters to the search query
5. THE Retrieval_Service SHALL return the top-k chunks where k is determined by the complexity mode: 3 for simple, 10 for detailed, 20 for deep
6. THE Retrieval_Service SHALL return each chunk with chunk_id, chunk_text, chunk_index, metadata, relevance_score, document_id, document_title, source_type, and source_url

### Requirement 15: Reasoning Service

**User Story:** As a researcher, I want Claude to reason over retrieved chunks using a selected persona, so that I receive contextual answers with source citations and follow-up suggestions.

#### Acceptance Criteria

1. WHEN a query is submitted with retrieved chunks, THE Reasoning_Service SHALL assemble a prompt containing the persona system prompt, retrieved chunks as context, conversation history (last 6 turns), and the user query
2. THE Reasoning_Service SHALL call the Anthropic Claude API (claude-sonnet-4-6) with the assembled prompt
3. THE Reasoning_Service SHALL parse the Claude response to extract the answer text and exactly 3 suggested follow-up questions
4. THE Reasoning_Service SHALL return a structured response containing answer, persona, complexity, sources array, and suggestions array
5. THE Reasoning_Service SHALL instruct Claude to reason strictly from the provided context and not invent facts
6. IF the provided context does not contain sufficient information, THEN THE Reasoning_Service SHALL instruct Claude to state this clearly in the answer

### Requirement 16: Persona Layer

**User Story:** As a researcher, I want to switch between strategist and analyst personas, so that the reasoning style matches my current need.

#### Acceptance Criteria

1. WHEN persona is set to "strategist", THE Reasoning_Service SHALL use a system prompt that emphasises high-level synthesis, implications, recommendations, and an executive concise tone
2. WHEN persona is set to "analyst", THE Reasoning_Service SHALL use a system prompt that emphasises structured detailed breakdowns, evidence citation, organised sections, and precise language
3. WHEN no persona is specified in the query, THE Reasoning_Service SHALL default to "strategist"
4. THE Persona layer SHALL modify only the system prompt and not affect retrieval, chunking, or embedding behaviour

### Requirement 17: Complexity Modes

**User Story:** As a researcher, I want to control the depth of retrieval and reasoning, so that I can get quick summaries or deep analyses as needed.

#### Acceptance Criteria

1. WHEN complexity is set to "simple", THE API SHALL retrieve 3 chunks and instruct Claude to provide a brief direct answer of 2-3 sentences maximum
2. WHEN complexity is set to "detailed", THE API SHALL retrieve 10 chunks and instruct Claude to provide a structured analysis using sections if helpful
3. WHEN complexity is set to "deep", THE API SHALL retrieve 20 chunks and instruct Claude to provide comprehensive reasoning with full evidence citation
4. WHEN no complexity is specified in the query, THE API SHALL default to "detailed"

### Requirement 18: Query Endpoint

**User Story:** As a researcher, I want a single query endpoint that retrieves relevant knowledge and returns a reasoned answer with sources and suggestions, so that I can interact with my knowledge base conversationally.

#### Acceptance Criteria

1. WHEN a JSON POST request is received at /research360/query with a query field, THE API SHALL embed the query, retrieve relevant chunks, run reasoning, and return a structured response
2. THE API SHALL return a response containing answer, persona, complexity, session_id, sources array, and suggestions array
3. THE API SHALL include in each source object: document_id, document_title, source_type, source_url, chunk_id, chunk_text, chunk_index, and relevance_score
4. THE API SHALL return exactly 3 suggested follow-up questions in the suggestions array
5. WHEN a session_id is provided, THE API SHALL load the existing session and include conversation history in the reasoning prompt
6. WHEN no session_id is provided, THE API SHALL create a new session and return the new session_id
7. WHEN the query completes, THE API SHALL save the user query and assistant response as a new turn in the session history
8. WHEN filters are provided (source_type, document_id), THE API SHALL pass those filters to the Retrieval_Service
9. IF the query field is missing or empty, THEN THE API SHALL return a 400 error with a descriptive error message

### Requirement 19: Session Management

**User Story:** As a researcher, I want conversation history to persist across turns within a session, so that I can ask follow-up questions that reference prior answers.

#### Acceptance Criteria

1. WHEN a new session is created, THE API SHALL insert a session record in the sessions table with a generated UUID and empty history array
2. WHEN a query turn completes, THE API SHALL append the user message and assistant response to the session's history JSONB array with role, content, persona (for assistant), and timestamp
3. WHEN loading session history for reasoning, THE API SHALL include the last 6 turns of conversation history in the prompt
4. WHEN a GET request is received at /research360/sessions/:id, THE API SHALL return the session_id and full history array
5. IF the session_id does not exist, THEN THE API SHALL return a 404 error with a descriptive error message

### Requirement 20: Health Check Endpoint

**User Story:** As a platform operator, I want a health check endpoint that reports the status of all dependencies, so that I can monitor system availability.

#### Acceptance Criteria

1. WHEN a GET request is received at /health, THE API SHALL return a JSON response with the overall status and individual status of Postgres, Redis, and S3
2. WHEN all dependencies are reachable, THE API SHALL return HTTP 200 with status "ok" for each dependency
3. IF any dependency is unreachable, THEN THE API SHALL return the specific dependency status as "error" while still returning HTTP 200 with the overall status reflecting the degraded state

### Requirement 21: Consistent Error Response Format

**User Story:** As a frontend developer, I want all API errors to follow a consistent format, so that error handling is predictable across all endpoints.

#### Acceptance Criteria

1. THE API SHALL return all error responses in the format: { "error": "human-readable message", "code": "ERROR_CODE" }
2. THE API SHALL use appropriate HTTP status codes: 400 for validation errors, 404 for not found, 500 for internal errors

### Requirement 22: Structured Logging

**User Story:** As a platform operator, I want all pipeline stages and API operations to produce structured JSON logs, so that I can monitor and debug the system effectively.

#### Acceptance Criteria

1. THE API SHALL log all pipeline stage entries and exits with timestamps, document_id, and stage name in structured JSON format
2. THE API SHALL log embedding operations with document_id, chunk_count, embedding_latency_ms, and token_usage
3. THE API SHALL log retrieval operations with result count and top relevance score
4. THE API SHALL log reasoning operations with LLM token usage (input and output tokens)
5. THE API SHALL log all errors with document_id (when available) and the pipeline stage where the error occurred

### Requirement 23: Queue Event Constants

**User Story:** As a developer, I want pipeline queue events defined as constants, so that event names are consistent across all workers and routes.

#### Acceptance Criteria

1. THE API SHALL define the following queue event constants: CONTENT_UPLOADED, CONTENT_EXTRACTED, CONTENT_TRANSFORMED, CHUNKS_CREATED, EMBEDDINGS_CREATED, INDEX_COMPLETE, PIPELINE_FAILED
2. THE API SHALL include document_id, tenant_id, timestamp, and stage in every queue event payload
3. WHEN a pipeline stage fails, THE API SHALL include the error message in the PIPELINE_FAILED event payload

### Requirement 24: Docker Containerisation

**User Story:** As a platform operator, I want the API packaged as a Docker container, so that it can be deployed to ECS.

#### Acceptance Criteria

1. THE API SHALL include a Dockerfile that builds a production-ready container image using Node.js 20
2. WHEN the Docker container starts, THE API SHALL run the Fastify server and all BullMQ workers within the same process
3. THE API SHALL include a .env.example file documenting all required environment variables
