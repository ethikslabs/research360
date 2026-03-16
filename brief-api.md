# Research360 — API Brief (Kiro)

## Your Job

Build the complete Research360 API. This is the backend of the platform knowledge layer. Read `architecture.md` fully before writing any code. Every decision is made there — do not deviate without flagging it.

---

## What You Are Building

A Fastify API with:
- File and URL ingestion endpoints
- A BullMQ pipeline processing documents through 4 worker stages
- pgvector semantic search retrieval
- A Claude-powered reasoning service that returns answers, sources, and suggestions
- A persona layer that modifies reasoning style
- Session-based conversation history

---

## Stack

- **Runtime**: Node.js 20
- **Framework**: Fastify
- **Queue**: Redis + BullMQ
- **Database**: Postgres + pgvector (RDS)
- **Object storage**: AWS S3
- **Embeddings**: OpenAI text-embedding-3-large (3072 dimensions)
- **Extraction**: Unstructured.io (docs), Playwright (web), yt-dlp + Whisper (audio/video)
- **Reasoning**: Anthropic Claude (claude-sonnet-4-6)
- **Deployment**: Docker + ECS

---

## Directory Structure

```
api/
├── src/
│   ├── routes/
│   │   ├── ingest.js        ← upload and URL ingestion endpoints
│   │   ├── query.js         ← query and reasoning endpoint
│   │   ├── documents.js     ← document listing and status
│   │   └── health.js        ← health check
│   ├── workers/
│   │   ├── extractionWorker.js
│   │   ├── transformWorker.js
│   │   ├── chunkWorker.js
│   │   └── embeddingWorker.js
│   ├── services/
│   │   ├── extractionService.js   ← Unstructured, Playwright, yt-dlp/Whisper
│   │   ├── transformService.js    ← normalisation and segmentation
│   │   ├── chunkService.js        ← chunking logic
│   │   ├── embeddingService.js    ← OpenAI embeddings
│   │   ├── retrievalService.js    ← pgvector search
│   │   ├── reasoningService.js    ← Claude reasoning + persona
│   │   └── s3Service.js           ← S3 upload/download
│   ├── db/
│   │   ├── client.js              ← Postgres connection
│   │   ├── migrations/
│   │   │   └── 001_initial.sql
│   │   └── queries/
│   │       ├── documents.js
│   │       ├── chunks.js
│   │       └── sessions.js
│   ├── queue/
│   │   ├── client.js              ← BullMQ setup
│   │   └── events.js              ← queue event constants
│   ├── config/
│   │   ├── env.js                 ← environment variable validation
│   │   └── personas.js            ← persona prompt definitions
│   └── app.js                     ← Fastify app setup
├── Dockerfile
├── package.json
└── .env.example
```

---

## Database

Run this migration on startup:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT NOT NULL DEFAULT 'ethikslabs',
  title        TEXT,
  source_type  TEXT NOT NULL,
  source_url   TEXT,
  file_name    TEXT,
  file_type    TEXT,
  s3_key       TEXT,
  status       TEXT NOT NULL DEFAULT 'PENDING',
  metadata     JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT NOT NULL DEFAULT 'ethikslabs',
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  chunk_text    TEXT NOT NULL,
  chunk_hash    TEXT NOT NULL,
  token_count   INTEGER,
  embedding     vector(3072),
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT NOT NULL DEFAULT 'ethikslabs',
  title        TEXT,
  history      JSONB DEFAULT '[]',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS chunks_tenant_doc_idx
  ON chunks (tenant_id, document_id);

CREATE UNIQUE INDEX IF NOT EXISTS chunks_hash_idx
  ON chunks (chunk_hash);
```

---

## API Routes

### POST /research360/ingest/file

Upload a document (PDF, DOCX, PPTX).

**Request**: `multipart/form-data`
- `file` — the file
- `title` (optional) — human-readable name
- `tenant_id` (optional, defaults to `ethikslabs`)

**Response**:
```json
{
  "document_id": "uuid",
  "status": "PENDING",
  "message": "Document queued for processing"
}
```

**Behaviour**:
1. Validate file type (PDF, DOCX, PPTX only)
2. Upload raw file to S3: `{tenant_id}/{document_id}/original`
3. Insert document record in Postgres with status `PENDING`
4. Enqueue `CONTENT_UPLOADED` job
5. Return document_id immediately — do not wait for processing

---

### POST /research360/ingest/url

Ingest a web page or YouTube URL.

**Request**: `application/json`
```json
{
  "url": "https://...",
  "title": "Optional title",
  "tenant_id": "ethikslabs"
}
```

**Response**:
```json
{
  "document_id": "uuid",
  "status": "PENDING",
  "source_type": "url",
  "message": "URL queued for processing"
}
```

**Behaviour**:
1. Detect source type: YouTube URL → `youtube`, all others → `url`
2. Insert document record
3. Enqueue `CONTENT_UPLOADED` job with url in metadata
4. Return immediately

---

### GET /research360/documents

List all documents.

**Query params**: `status`, `source_type`, `limit` (default 50), `offset`

**Response**:
```json
{
  "documents": [
    {
      "id": "uuid",
      "title": "...",
      "source_type": "document",
      "status": "INDEXED",
      "file_name": "...",
      "created_at": "..."
    }
  ],
  "total": 42
}
```

---

### GET /research360/documents/:id

Get document status and metadata.

**Response**:
```json
{
  "id": "uuid",
  "title": "...",
  "source_type": "youtube",
  "status": "INDEXED",
  "chunk_count": 34,
  "metadata": {},
  "created_at": "..."
}
```

---

### DELETE /research360/documents/:id

Delete document and all associated chunks.

**Behaviour**:
1. Delete all chunks (CASCADE handles this)
2. Delete document record
3. Delete S3 artifacts
4. Return 204

---

### POST /research360/query

Main query endpoint. Retrieves relevant chunks and runs reasoning.

**Request**:
```json
{
  "query": "What are the key insights from the AI infrastructure podcast?",
  "tenant_id": "ethikslabs",
  "persona": "strategist",
  "complexity": "detailed",
  "session_id": "uuid-optional",
  "filters": {
    "source_type": "youtube",
    "document_id": "uuid-optional"
  }
}
```

**Defaults**: persona = `strategist`, complexity = `detailed`

**Response**:
```json
{
  "answer": "...",
  "persona": "strategist",
  "complexity": "detailed",
  "session_id": "uuid",
  "sources": [
    {
      "document_id": "uuid",
      "document_title": "AI Infrastructure Podcast",
      "source_type": "youtube",
      "source_url": "https://youtube.com/...",
      "chunk_id": "uuid",
      "chunk_text": "...",
      "chunk_index": 4,
      "relevance_score": 0.91
    }
  ],
  "suggestions": [
    "What are the key risks raised in this content?",
    "How does this compare to your research on cloud architecture?",
    "Generate a strategic summary of these findings"
  ]
}
```

**Behaviour**:
1. Load or create session
2. Embed query using OpenAI
3. Retrieve top-k chunks from pgvector (k depends on complexity mode)
4. Apply metadata filters if provided
5. Assemble prompt with persona system prompt + chunks + history + query
6. Call Claude — parse answer + suggestions from response
7. Save turn to session history
8. Return full response

---

### GET /research360/sessions/:id

Get session history.

**Response**:
```json
{
  "session_id": "uuid",
  "history": [
    {
      "role": "user",
      "content": "...",
      "timestamp": "..."
    },
    {
      "role": "assistant",
      "content": "...",
      "persona": "strategist",
      "timestamp": "..."
    }
  ]
}
```

---

### GET /health

Returns 200 with status of all dependencies.

```json
{
  "status": "ok",
  "postgres": "ok",
  "redis": "ok",
  "s3": "ok"
}
```

---

## Workers

### extractionWorker.js

Consumes `CONTENT_UPLOADED` queue.

```
if source_type === 'document':
  download from S3
  send to Unstructured.io API
  receive raw text

if source_type === 'url':
  launch Playwright
  navigate to URL
  extract article text via Readability
  close browser

if source_type === 'youtube':
  run yt-dlp to download audio
  run Whisper (openai-whisper or whisper.cpp) to transcribe
  receive transcript text

save extracted text to S3: {tenant_id}/{document_id}/extracted
update document status to EXTRACTED
enqueue CONTENT_EXTRACTED
```

---

### transformWorker.js

Consumes `CONTENT_EXTRACTED`.

```
download extracted text from S3
apply normalisation:
  - strip repeated whitespace, control characters
  - remove filler words from transcripts (um, uh, you know)
  - reconstruct broken paragraphs (join lines that don't end with punctuation)
  - normalise unicode
  - identify semantic boundaries (double newlines, headers, topic shifts)
save transformed text to S3: {tenant_id}/{document_id}/transformed
update document status to TRANSFORMED
enqueue CONTENT_TRANSFORMED
```

---

### chunkWorker.js

Consumes `CONTENT_TRANSFORMED`.

```
download transformed text from S3
segment into chunks:
  - target 700 tokens per chunk
  - 15% overlap between chunks
  - respect semantic boundaries — do not split mid-paragraph
  - use tiktoken to count tokens accurately
for each chunk:
  insert into chunks table with chunk_index, chunk_text, chunk_hash
update document status to CHUNKED
enqueue CHUNKS_CREATED
```

Use `js-tiktoken` or `tiktoken` npm package for token counting.
Use `crypto.createHash('sha256')` for chunk hashing.

---

### embeddingWorker.js

Consumes `CHUNKS_CREATED`.

```
load all chunks for document_id where embedding IS NULL
batch into groups of 100
for each batch:
  check chunk_hash against existing embeddings — skip duplicates
  call OpenAI embeddings API with batch
  store vectors in chunks.embedding column
update document status to INDEXED
enqueue INDEX_COMPLETE
log: document_id, chunk_count, embedding_latency_ms, token_usage
```

---

## Services

### retrievalService.js

```javascript
async function retrieve({ query, tenantId, k, filters }) {
  const queryEmbedding = await embedText(query)
  
  let sql = `
    SELECT 
      c.id as chunk_id,
      c.chunk_text,
      c.chunk_index,
      c.metadata,
      1 - (c.embedding <=> $1) as relevance_score,
      d.id as document_id,
      d.title as document_title,
      d.source_type,
      d.source_url
    FROM chunks c
    JOIN documents d ON c.document_id = d.id
    WHERE c.tenant_id = $2
      AND c.embedding IS NOT NULL
  `
  
  // apply optional filters
  // ORDER BY relevance_score DESC
  // LIMIT k
}
```

---

### reasoningService.js

```javascript
const COMPLEXITY_CONFIG = {
  simple:   { k: 3,  style: 'Brief, direct answer. 2-3 sentences maximum.' },
  detailed: { k: 10, style: 'Structured analysis. Use sections if helpful.' },
  deep:     { k: 20, style: 'Comprehensive reasoning. Full evidence citation.' }
}

async function reason({ query, chunks, persona, complexity, history }) {
  const personaPrompt = PERSONAS[persona]
  const config = COMPLEXITY_CONFIG[complexity]
  
  const systemPrompt = `
You are Research360, a knowledge reasoning assistant for ethikslabs.

${personaPrompt}

You reason strictly from the provided context. You do not invent facts.
If the context does not contain sufficient information, say so clearly.
Reasoning style: ${config.style}

Always end your response with exactly 3 suggested follow-up questions the user 
might want to explore next, formatted as a JSON array under the key "suggestions".

Format your full response as JSON:
{
  "answer": "your full answer here",
  "suggestions": ["question 1", "question 2", "question 3"]
}
`
  // call Claude, parse JSON response
  // return { answer, suggestions }
}
```

---

### personas.js

```javascript
export const PERSONAS = {
  strategist: `
Persona: Strategist
You synthesise information at a high level. 
You focus on implications, opportunities, and recommendations.
You frame answers around: so what, what next, what matters.
Tone: executive, concise, forward-looking.
  `,
  
  analyst: `
Persona: Analyst  
You provide detailed, structured breakdowns of information.
You cite specific evidence from the sources.
You organise responses with clear sections and precise language.
Tone: thorough, methodical, evidence-driven.
  `
}
```

---

## Error Handling

- All workers retry failed jobs max 3 times with exponential backoff (1s, 5s, 30s)
- Failed jobs after max retries update document status to `FAILED` with error message in metadata
- All routes return consistent error shape: `{ error: "message", code: "ERROR_CODE" }`
- Log all errors with document_id and stage

---

## Environment Variables

```
DATABASE_URL=postgres://...
REDIS_URL=redis://...
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=research360
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
UNSTRUCTURED_API_KEY=...
PORT=3000
NODE_ENV=development
```

Validate all on startup — fail fast if any are missing.

---

## Key npm Packages

```json
{
  "fastify": "^4",
  "@fastify/multipart": "^8",
  "bullmq": "^5",
  "ioredis": "^5",
  "pg": "^8",
  "pgvector": "^0.2",
  "openai": "^4",
  "@anthropic-ai/sdk": "^0.24",
  "@aws-sdk/client-s3": "^3",
  "playwright": "^1",
  "tiktoken": "^1",
  "dotenv": "^16"
}
```

---

## Build Order Within API

Build in this sequence:

1. `config/env.js` — validate environment
2. `db/client.js` + migration — get Postgres + pgvector running
3. `queue/client.js` — BullMQ connected to Redis
4. `services/s3Service.js` — upload and download working
5. `routes/ingest.js` + `workers/extractionWorker.js` — can ingest a PDF
6. `workers/transformWorker.js` + `workers/chunkWorker.js`
7. `services/embeddingService.js` + `workers/embeddingWorker.js` — chunks get vectors
8. `services/retrievalService.js` — pgvector search working
9. `services/reasoningService.js` — Claude returns answer + sources + suggestions
10. `routes/query.js` — full query endpoint wired up
11. `routes/documents.js` + `routes/health.js`
12. Dockerfile

Test at each step. Do not move forward until the current step works.

---

## Definition of Done

- PDF can be uploaded, processed through pipeline, and queried
- YouTube URL can be ingested, transcribed, and queried
- Web URL can be ingested and queried
- Query returns `answer`, `sources[]`, and `suggestions[]`
- Sources include `chunk_text`, `document_title`, `relevance_score`
- Persona switching changes response style
- Complexity mode changes retrieval depth
- Session history persists across turns in a session
- All pipeline stages log structured JSON
- Health endpoint returns status of all dependencies
- Docker container builds and runs