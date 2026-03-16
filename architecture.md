# Research360 — Architecture

## What This Is

Research360 is the knowledge ingestion, retrieval, and reasoning substrate for the ethikslabs platform. Every product in the platform (Proof360, Trust360, Cloud360, etc.) runs its reasoning layer on top of Research360.

It converts any content source — documents, web pages, YouTube videos — into structured, queryable knowledge. Users interact with that knowledge through a chat interface that returns answers, sources, and suggested next exploration paths, interpreted through a persona lens.

---

## Core Principle

Research360 does not invent answers. It retrieves evidence and reasons over it. Every response must be traceable to a source chunk. This is the architectural constraint that drives everything below.

---

## System Overview

```
Client (Frontend)
      ↓
  Fastify API
      ↓
Redis Queue (BullMQ)
      ↓
   Workers
   ├── Extraction Worker   (Unstructured.io / Playwright / yt-dlp + Whisper)
   ├── Transform Worker    (clean, normalise, reconstruct)
   ├── Chunk Worker        (semantic segmentation)
   └── Embedding Worker    (OpenAI text-embedding-3-large → pgvector)
      ↓
Postgres + pgvector
      ↓
  Retrieval API
      ↓
Reasoning Service (Claude Sonnet)
      ↓
  Response
  ├── answer
  ├── sources[]
  └── suggestions[]
```

Raw artifacts stored in S3 throughout pipeline.

---

## Stack Decisions

| Layer | Choice | Rationale |
|---|---|---|
| API framework | Fastify | Lightweight, fast, consistent with platform |
| Queue | Redis + BullMQ | Right-sized for pipeline events, Node-native |
| Vector DB | pgvector on RDS Postgres | No new infra, strong MVP performance |
| Object storage | AWS S3 | AWS-native, raw artifact store |
| Embeddings | OpenAI text-embedding-3-large | Best semantic quality, 3072 dimensions |
| Extraction — docs | Unstructured.io | PDF, DOCX, PPTX |
| Extraction — web | Playwright | Dynamic page rendering + article extraction |
| Extraction — audio/video | yt-dlp + Whisper | YouTube, podcasts, audio files |
| LLM reasoning | Claude Sonnet (claude-sonnet-4-6) | Reasoning, summarisation, structured extraction |
| Deployment | ECS + Docker | AWS-native, no Kubernetes complexity at MVP |

---

## Repo Structure

```
research360/
├── docs/
│   ├── architecture.md        ← this file
│   ├── brief-api.md           ← Kiro builds from this
│   └── brief-frontend.md      ← Claude Code builds from this
├── api/                       ← Kiro builds this
│   ├── src/
│   │   ├── routes/
│   │   ├── workers/
│   │   ├── services/
│   │   ├── db/
│   │   └── config/
│   ├── Dockerfile
│   └── package.json
└── frontend/                  ← Claude Code builds this
    ├── src/
    ├── Dockerfile
    └── package.json
```

---

## Pipeline Stages

### 1. Ingestion

Accepts three source types at MVP:

- **Document** — PDF, DOCX, PPTX uploaded as file
- **URL** — web page parsed via Playwright
- **YouTube** — video URL, audio extracted via yt-dlp, transcribed via Whisper

On receipt, API:
1. Saves raw artifact to S3: `s3://research360/{tenant_id}/{document_id}/original`
2. Creates document record in Postgres with status `PENDING`
3. Enqueues `CONTENT_UPLOADED` job in BullMQ

### 2. Extraction Worker

Consumes `CONTENT_UPLOADED`. Extracts raw text based on source type:

- Documents → Unstructured.io → raw text
- URLs → Playwright → article text via Readability
- YouTube → yt-dlp → audio → Whisper → transcript

Saves extracted text to S3: `s3://research360/{tenant_id}/{document_id}/extracted`
Updates document status to `EXTRACTED`
Enqueues `CONTENT_EXTRACTED`

### 3. Transform Worker

Consumes `CONTENT_EXTRACTED`. Normalises raw text:

- Remove filler words, repeated characters, formatting artefacts
- Reconstruct broken paragraphs (critical for PDF and transcript quality)
- Normalise whitespace and encoding
- Semantic segmentation — identify natural topic boundaries

Saves normalised text to S3: `s3://research360/{tenant_id}/{document_id}/transformed`
Updates status to `TRANSFORMED`
Enqueues `CONTENT_TRANSFORMED`

### 4. Chunk Worker

Consumes `CONTENT_TRANSFORMED`. Segments into overlapping chunks:

- Chunk size: 600–800 tokens
- Overlap: 15%
- Respect semantic boundaries from transform stage — do not split mid-topic

Saves chunks to Postgres `chunks` table with metadata.
Updates status to `CHUNKED`
Enqueues `CHUNKS_CREATED`

### 5. Embedding Worker

Consumes `CHUNKS_CREATED`. For each chunk:

- Calls OpenAI text-embedding-3-large API
- Stores 3072-dimension vector in pgvector `chunks.embedding` column
- Batch process chunks (max 100 per API call)
- Hash chunk text before embedding — skip if hash already exists (deduplication)

Updates status to `INDEXED`
Enqueues `INDEX_COMPLETE`

---

## Database Schema

### documents

```sql
CREATE TABLE documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT NOT NULL DEFAULT 'ethikslabs',
  title        TEXT,
  source_type  TEXT NOT NULL,  -- 'document' | 'url' | 'youtube'
  source_url   TEXT,
  file_name    TEXT,
  file_type    TEXT,
  s3_key       TEXT,
  status       TEXT NOT NULL DEFAULT 'PENDING',
  metadata     JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
```

### chunks

```sql
CREATE TABLE chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT NOT NULL DEFAULT 'ethikslabs',
  document_id   UUID NOT NULL REFERENCES documents(id),
  chunk_index   INTEGER NOT NULL,
  chunk_text    TEXT NOT NULL,
  chunk_hash    TEXT NOT NULL,
  token_count   INTEGER,
  embedding     vector(3072),
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON chunks (tenant_id, document_id);
CREATE UNIQUE INDEX ON chunks (chunk_hash);
```

> HNSW index is mandatory. Add it on first migration or retrieval degrades at scale.

---

## Retrieval

Semantic search pipeline:

```
user query
    ↓
embed query (OpenAI text-embedding-3-large)
    ↓
pgvector cosine similarity search
    ↓
top-k chunks (default k=10)
    ↓
optional metadata filters (source_type, date range, document_id)
    ↓
return chunks with metadata
```

Retrieval must always enforce `tenant_id` filter. This is non-negotiable even in single-tenant MVP — the schema must be correct from day one.

---

## Reasoning Service

Sits above retrieval. Constructs LLM prompt from:

1. Persona system prompt (see Persona Layer below)
2. Retrieved chunks as context
3. User query
4. Conversation history (last N turns)

Returns structured response:

```json
{
  "answer": "...",
  "persona": "strategist",
  "complexity": "detailed",
  "sources": [
    {
      "document_id": "...",
      "document_title": "...",
      "source_type": "youtube",
      "chunk_id": "...",
      "chunk_text": "...",
      "chunk_index": 4,
      "relevance_score": 0.91
    }
  ],
  "suggestions": [
    "What are the key risks raised in this document?",
    "How does this compare to your previous research on this topic?",
    "Generate a strategic summary of these findings"
  ]
}
```

Suggestions are generated by the LLM as part of the same call — not a separate request.

---

## Persona Layer

Two personas at MVP. Personas modify the system prompt only — they do not affect retrieval, chunking, or embedding.

### Strategist
- High-level synthesis
- So-what framing
- Implications and recommendations
- Concise, executive tone

### Analyst
- Structured, detailed breakdown
- Evidence-heavy
- Organised sections
- Precise language

Persona is passed as a parameter on every `/query` call. Defaults to `strategist` if not specified.

System prompt template:

```
You are Research360, a knowledge reasoning assistant for ethikslabs.

Persona: {persona_prompt}

You reason strictly from the provided context. You do not invent facts.
If the context does not contain sufficient information, say so clearly.

Always end your response with 3 suggested follow-up questions the user might want to explore next.

Context:
{chunks}

Conversation history:
{history}

User question:
{query}
```

---

## Complexity Modes

Controls retrieval depth and reasoning depth. Passed as parameter on `/query`.

| Mode | Chunks retrieved | Reasoning style |
|---|---|---|
| `simple` | 3 | Brief summary answer |
| `detailed` | 10 | Structured analysis with sections |
| `deep` | 20 | Full reasoning, all evidence, long-form |

Default: `detailed`

---

## Conversation Context

Each conversation session has a `session_id`. The last 6 turns of conversation history are passed to the reasoning service on every query. This allows:

- Follow-up questions that reference prior answers
- "What did we conclude about X?" queries within a session

Sessions are stored in Postgres. Future: sessions become queryable Research360 documents themselves.

---

## Queue Events

```
CONTENT_UPLOADED
CONTENT_EXTRACTED
CONTENT_TRANSFORMED
CHUNKS_CREATED
EMBEDDINGS_CREATED
INDEX_COMPLETE
PIPELINE_FAILED
```

Every event carries: `document_id`, `tenant_id`, `timestamp`, `stage`, `error` (if failed).

---

## S3 Structure

```
s3://research360/
  {tenant_id}/
    {document_id}/
      original          ← raw upload or downloaded file
      extracted         ← raw extracted text
      transformed       ← normalised text
      transcript        ← audio transcripts (YouTube/audio sources)
```

---

## Observability

Every pipeline stage logs:

- Stage entry/exit timestamps
- Document and chunk counts
- Embedding latency per batch
- Retrieval result count and top score
- LLM token usage per query (input + output)
- Pipeline failures with stage and error

Use structured JSON logs. Ship to CloudWatch at MVP. Add Prometheus + Grafana later.

---

## Cost Controls

- **Deduplication**: hash chunk text before embedding. Skip if hash exists in `chunks` table.
- **Batch embedding**: max 100 chunks per OpenAI API call
- **Caching**: cache embeddings by hash — same content ingested twice costs nothing
- **Status tracking**: failed pipeline stages retry max 3 times with exponential backoff

---

## Environment Variables

```
DATABASE_URL
REDIS_URL
AWS_REGION
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
S3_BUCKET
OPENAI_API_KEY
ANTHROPIC_API_KEY
UNSTRUCTURED_API_KEY
PORT
NODE_ENV
```

---

## Build Order

1. Kiro builds `api/` — full pipeline, all workers, all routes
2. Claude Code builds `frontend/` — chat interface consuming the API
3. Integration test: ingest a PDF, query it, verify sources appear
4. Integration test: ingest a YouTube URL, query transcript, verify sources
5. Deploy to ECS

---

## What This Enables

Once Research360 is running:

- **Proof360** refactors its reasoning layer to call Research360 retrieval instead of inline processing
- **Trust360** uses Research360 as its evidence substrate
- Every new ethikslabs product gets retrieval + reasoning for free
- Personal knowledge base: John ingests all research, papers, decks — queries across everything

Research360 is the truth substrate of the platform.