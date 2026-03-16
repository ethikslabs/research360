import { Worker } from 'bullmq'
import { redis } from '../queue/client.js'
import { EVENTS, buildPayload, enqueue } from '../queue/events.js'
import { embedTexts } from '../services/embeddingService.js'
import { updateStatus, updateMetadata } from '../db/queries/documents.js'
import { findNullEmbeddings, updateEmbedding } from '../db/queries/chunks.js'

const BATCH_SIZE = 100

export function startEmbeddingWorker() {
  const worker = new Worker('embedding', async (job) => {

    const { document_id, tenant_id } = job.data
    const start = Date.now()
    console.log(JSON.stringify({ stage: 'embedding', document_id, timestamp: new Date().toISOString() }))

    const chunks = await findNullEmbeddings(document_id)
    if (!chunks.length) {
      await updateStatus(document_id, 'INDEXED')
      await enqueue(EVENTS.INDEX_COMPLETE, buildPayload(document_id, tenant_id, EVENTS.INDEX_COMPLETE))
      return
    }

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE)
      const texts = batch.map(c => c.chunk_text)
      const embeddings = await embedTexts(texts)
      for (let j = 0; j < batch.length; j++) {
        await updateEmbedding(batch[j].id, embeddings[j])
      }
    }

    const latency = Date.now() - start
    await updateStatus(document_id, 'INDEXED')
    await enqueue(EVENTS.INDEX_COMPLETE, buildPayload(document_id, tenant_id, EVENTS.INDEX_COMPLETE))

    console.log(JSON.stringify({
      stage: 'embedding_complete',
      document_id,
      chunk_count: chunks.length,
      embedding_latency_ms: latency,
      timestamp: new Date().toISOString(),
    }))
  }, {
    connection: redis,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  })

  worker.on('failed', async (job, err) => {
    if (job.attemptsMade >= job.opts.attempts) {
      const { document_id } = job.data
      await updateStatus(document_id, 'FAILED')
      await updateMetadata(document_id, { error: err.message, failed_stage: 'embedding' })
      console.log(JSON.stringify({ stage: 'embedding_failed', document_id, error: err.message }))
    }
  })

  return worker
}
