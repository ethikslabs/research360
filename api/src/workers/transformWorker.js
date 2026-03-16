import { Worker } from 'bullmq'
import { redis } from '../queue/client.js'
import { EVENTS, buildPayload, enqueue } from '../queue/events.js'
import { transform } from '../services/transformService.js'
import { upload, download } from '../services/s3Service.js'
import { updateStatus, updateMetadata, updateTitle } from '../db/queries/documents.js'

export function startTransformWorker() {
  const worker = new Worker('transform', async (job) => {

    const { document_id, tenant_id } = job.data
    console.log(JSON.stringify({ stage: 'transform', document_id, timestamp: new Date().toISOString() }))

    const rawBuffer = await download(tenant_id, document_id, 'extracted')
    const { text } = transform(rawBuffer.toString('utf8'))

    // Extract title from first meaningful line if not already set
    const firstLine = text.split('\n').map(l => l.trim()).find(l => l.length > 10 && l.length < 120)
    if (firstLine) await updateTitle(document_id, firstLine)

    await upload(tenant_id, document_id, 'transformed', Buffer.from(text), 'text/plain')
    await updateStatus(document_id, 'TRANSFORMED')
    await enqueue(EVENTS.CONTENT_TRANSFORMED, buildPayload(document_id, tenant_id, EVENTS.CONTENT_TRANSFORMED))

    console.log(JSON.stringify({ stage: 'transform_complete', document_id, timestamp: new Date().toISOString() }))
  }, {
    connection: redis,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  })

  worker.on('failed', async (job, err) => {
    if (job.attemptsMade >= job.opts.attempts) {
      const { document_id, tenant_id } = job.data
      await updateStatus(document_id, 'FAILED')
      await updateMetadata(document_id, { error: err.message, failed_stage: 'transform' })
      console.log(JSON.stringify({ stage: 'transform_failed', document_id, error: err.message }))
    }
  })

  return worker
}
