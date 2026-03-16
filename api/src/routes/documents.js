import { findById, findAll, remove } from '../db/queries/documents.js'
import { deleteAll, presign } from '../services/s3Service.js'

const DEFAULT_TENANT = 'ethikslabs'

export default async function documentRoutes(app) {
  app.get('/research360/documents', async (request, reply) => {
    const { status, source_type, limit = 50, offset = 0 } = request.query
    const tenantId = request.headers['x-tenant-id'] || DEFAULT_TENANT
    const result = await findAll({ tenantId, status, sourceType: source_type, limit: parseInt(limit), offset: parseInt(offset) })
    return reply.send(result)
  })

  app.get('/research360/documents/:id', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] || DEFAULT_TENANT
    const doc = await findById(request.params.id, tenantId)
    if (!doc) return reply.status(404).send({ error: 'Document not found', code: 'DOCUMENT_NOT_FOUND' })
    return reply.send(doc)
  })

  app.get('/research360/documents/:id/download', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] || DEFAULT_TENANT
    const doc = await findById(request.params.id, tenantId)
    if (!doc) return reply.status(404).send({ error: 'Document not found', code: 'DOCUMENT_NOT_FOUND' })
    if (doc.source_type !== 'document') return reply.status(400).send({ error: 'Not a file document', code: 'NOT_A_FILE' })
    const url = await presign(tenantId, request.params.id)
    return reply.redirect(url)
  })

  app.delete('/research360/documents/:id', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] || DEFAULT_TENANT
    const doc = await findById(request.params.id, tenantId)
    if (!doc) return reply.status(404).send({ error: 'Document not found', code: 'DOCUMENT_NOT_FOUND' })

    await remove(request.params.id, tenantId)
    await deleteAll(tenantId, request.params.id).catch(() => {})

    return reply.status(204).send()
  })
}
