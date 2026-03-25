import { Worker } from 'bullmq'
import { redis } from '../queue/client.js'
import { EVENTS, buildPayload, enqueue } from '../queue/events.js'
import { chunk } from '../services/chunkService.js'
import { download } from '../services/s3Service.js'
import { updateStatus, updateMetadata } from '../db/queries/documents.js'
import { insertBatch } from '../db/queries/chunks.js'
import { buildChunkRow } from '../services/provenanceService.js'

export function startChunkWorker() {
  const worker = new Worker('chunk', async (job) => {

    const { document_id, tenant_id, provenance_meta } = job.data
    console.log(JSON.stringify({ stage: 'chunking', document_id, timestamp: new Date().toISOString() }))

    const buffer = await download(tenant_id, document_id, 'transformed')
    const chunks = chunk(buffer.toString('utf8'))

    const provenanceRow = buildChunkRow(provenance_meta)

    await insertBatch(chunks.map(c => ({
      tenantId:  tenant_id,
      documentId: document_id,
      chunkIndex: c.chunk_index,
      chunkText:  c.chunk_text,
      chunkHash:  c.chunk_hash,
      tokenCount: c.token_count,
      ...provenanceRow,
    })))

    await updateStatus(document_id, 'CHUNKED')
    await enqueue(EVENTS.CHUNKS_CREATED, buildPayload(document_id, tenant_id, EVENTS.CHUNKS_CREATED))

    console.log(JSON.stringify({ stage: 'chunking_complete', document_id, chunk_count: chunks.length, timestamp: new Date().toISOString() }))
  }, {
    connection: redis,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  })

  worker.on('failed', async (job, err) => {
    if (job.attemptsMade >= job.opts.attempts) {
      const { document_id } = job.data
      await updateStatus(document_id, 'FAILED')
      await updateMetadata(document_id, { error: err.message, failed_stage: 'chunking' })
      console.log(JSON.stringify({ stage: 'chunking_failed', document_id, error: err.message }))
    }
  })

  return worker
}
