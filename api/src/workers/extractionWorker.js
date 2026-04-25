import { Worker } from 'bullmq'
import { redis } from '../queue/client.js'
import { EVENTS, buildPayload, enqueue } from '../queue/events.js'
import { extract } from '../services/extractionService.js'
import { upload } from '../services/s3Service.js'
import { updateStatus, updateMetadata, findById } from '../db/queries/documents.js'
import { config } from '../config/env.js'

const RETRY_CONFIG = { attempts: 3, backoff: { type: 'exponential', delay: 1000 } }

export function startExtractionWorker() {
  const worker = new Worker('extraction', async (job) => {

    const { document_id, tenant_id } = job.data
    console.log(JSON.stringify({ stage: 'extraction', document_id, timestamp: new Date().toISOString() }))

    const doc = await findById(document_id, tenant_id)
    if (!doc) throw new Error(`Document not found: ${document_id}`)

    const { text, extraction_confidence, extraction_method, extra_metadata } = await extract(doc)

    await upload(tenant_id, document_id, 'extracted', Buffer.from(text), 'text/plain')

    // Write PPTX conversion metadata before status update
    if (extra_metadata) {
      await updateMetadata(document_id, extra_metadata)
    }

    // Raw snapshot — L1/L3/L5 only (not company/session-scoped L2 docs or discovery tier 2)
    let raw_snapshot_uri = null
    const isL2 = Boolean(doc.metadata?.company_id) || Boolean(doc.metadata?.session_id) ||
                 (doc.source_type === 'url' && doc.metadata?.source_tier === 2)
    if (!isL2) {
      if (doc.source_type === 'document') {
        // Original file already in S3 — reference it directly as the snapshot
        raw_snapshot_uri = `s3://${config.S3_BUCKET}/${tenant_id}/${document_id}/original`
      } else {
        // URL/YouTube — upload extracted text as snapshot (raw HTML not captured in v1)
        const snapshotKey = await upload(tenant_id, document_id, 'snapshot', Buffer.from(text), 'text/plain')
        raw_snapshot_uri = `s3://${config.S3_BUCKET}/${snapshotKey}`
      }
    }

    const provenance_meta = {
      document_id,
      tenant_id,
      source_type:           doc.source_type,
      file_type:             doc.file_type,
      source_url:            doc.source_url,
      canonical_uri:         doc.metadata?.canonical_uri ?? doc.metadata?.canonical_url ?? doc.source_url ?? null,
      title:                 doc.title,
      extraction_confidence,
      extraction_method,
      ingested_at:           new Date().toISOString(),
      ingested_by:           'ingestion-bot-v1',
      retrieved_at:          doc.source_type === 'document'
                               ? (doc.created_at?.toISOString?.() ?? new Date().toISOString())
                               : new Date().toISOString(),
      raw_snapshot_uri,
      source_tier:           doc.metadata?.source_tier ?? null,
      company_id:            doc.metadata?.company_id ?? null,
      session_id:            doc.metadata?.session_id ?? null,
    }

    await updateStatus(document_id, 'EXTRACTED')
    await enqueue(EVENTS.CONTENT_EXTRACTED, { ...buildPayload(document_id, tenant_id, EVENTS.CONTENT_EXTRACTED), provenance_meta })

    console.log(JSON.stringify({ stage: 'extraction_complete', document_id, timestamp: new Date().toISOString() }))
  }, {
    connection: redis,
    concurrency: 5,
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
