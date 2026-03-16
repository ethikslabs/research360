import { insert } from '../db/queries/documents.js'
import { upload } from '../services/s3Service.js'
import { enqueue, EVENTS, buildPayload } from '../queue/events.js'

const ALLOWED_TYPES = ['pdf', 'docx', 'pptx']

function isYouTube(url) {
  return /youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts/.test(url)
}

export default async function ingestRoutes(app) {
  app.post('/research360/ingest/file', async (request, reply) => {
    const data = await request.file()
    if (!data) {
      return reply.status(400).send({ error: 'No file provided', code: 'MISSING_FILE' })
    }

    const ext = data.filename.split('.').pop().toLowerCase()
    if (!ALLOWED_TYPES.includes(ext)) {
      return reply.status(400).send({ error: `File type .${ext} not supported. Accepted: PDF, DOCX, PPTX`, code: 'INVALID_FILE_TYPE' })
    }

    const fields = data.fields || {}
    const rawTitle = fields.title?.value?.trim()
    const title = rawTitle || data.filename.replace(/\.[^.]+$/, '')
    const tenantId = fields.tenant_id?.value || 'ethikslabs'

    const doc = await insert({ tenantId, title, sourceType: 'document', fileName: data.filename, fileType: ext })

    const fileBuffer = await data.toBuffer()
    const s3Key = await upload(tenantId, doc.id, 'original', fileBuffer, data.mimetype)

    await enqueue(EVENTS.CONTENT_UPLOADED, buildPayload(doc.id, tenantId, EVENTS.CONTENT_UPLOADED))

    return reply.status(201).send({
      document_id: doc.id,
      status: 'PENDING',
      message: 'Document queued for processing',
    })
  })

  app.post('/research360/ingest/url', async (request, reply) => {
    const { url, title, tenant_id } = request.body || {}

    if (!url?.trim()) {
      return reply.status(400).send({ error: 'url is required', code: 'MISSING_URL' })
    }

    const tenantId = tenant_id || 'ethikslabs'
    const sourceType = isYouTube(url) ? 'youtube' : 'url'

    const doc = await insert({ tenantId, title: title || null, sourceType, sourceUrl: url })

    await enqueue(EVENTS.CONTENT_UPLOADED, buildPayload(doc.id, tenantId, EVENTS.CONTENT_UPLOADED))

    return reply.status(201).send({
      document_id: doc.id,
      status: 'PENDING',
      source_type: sourceType,
      message: 'URL queued for processing',
    })
  })
}
