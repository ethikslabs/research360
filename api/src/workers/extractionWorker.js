import { Worker } from 'bullmq'
import { redis } from '../queue/client.js'
import { EVENTS, buildPayload, enqueue } from '../queue/events.js'
import { extract } from '../services/extractionService.js'
import { upload } from '../services/s3Service.js'
import { updateStatus, updateMetadata, findById } from '../db/queries/documents.js'

const RETRY_CONFIG = { attempts: 3, backoff: { type: 'exponential', delay: 1000 } }

export function startExtractionWorker() {
  const worker = new Worker('extraction', async (job) => {

    const { document_id, tenant_id } = job.data
    console.log(JSON.stringify({ stage: 'extraction', document_id, timestamp: new Date().toISOString() }))

    const doc = await findById(document_id, tenant_id)
    if (!doc) throw new Error(`Document not found: ${document_id}`)

    const text = await extract(doc)
    await upload(tenant_id, document_id, 'extracted', Buffer.from(text), 'text/plain')
    await updateStatus(document_id, 'EXTRACTED')
    await enqueue(EVENTS.CONTENT_EXTRACTED, buildPayload(document_id, tenant_id, EVENTS.CONTENT_EXTRACTED))

    console.log(JSON.stringify({ stage: 'extraction_complete', document_id, timestamp: new Date().toISOString() }))
  }, {
    connection: redis,
    ...RETRY_CONFIG,
  })

  worker.on('failed', async (job, err) => {
    if (job.attemptsMade >= job.opts.attempts) {
      const { document_id, tenant_id } = job.data
      await updateStatus(document_id, 'FAILED')
      await updateMetadata(document_id, { error: err.message, failed_stage: 'extraction' })
      await enqueue(EVENTS.PIPELINE_FAILED, buildPayload(document_id, tenant_id, 'extraction', err.message))
      console.log(JSON.stringify({ stage: 'extraction_failed', document_id, error: err.message }))
    }
  })

  return worker
}
