import { queues } from './client.js'

export const EVENTS = {
  CONTENT_UPLOADED:    'CONTENT_UPLOADED',
  CONTENT_EXTRACTED:   'CONTENT_EXTRACTED',
  CONTENT_TRANSFORMED: 'CONTENT_TRANSFORMED',
  CHUNKS_CREATED:      'CHUNKS_CREATED',
  EMBEDDINGS_CREATED:  'EMBEDDINGS_CREATED',
  INDEX_COMPLETE:      'INDEX_COMPLETE',
  PIPELINE_FAILED:     'PIPELINE_FAILED',
}

const QUEUE_MAP = {
  CONTENT_UPLOADED:    'extraction',
  CONTENT_EXTRACTED:   'transform',
  CONTENT_TRANSFORMED: 'chunk',
  CHUNKS_CREATED:      'embedding',
}

export function buildPayload(documentId, tenantId, stage, error = null) {
  const payload = { document_id: documentId, tenant_id: tenantId, timestamp: new Date().toISOString(), stage }
  if (error) payload.error = error
  return payload
}

export async function enqueue(eventName, payload) {
  const queueName = QUEUE_MAP[eventName]
  if (!queueName) return null
  const job = await queues[queueName].add(eventName, payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  })
  return job
}
