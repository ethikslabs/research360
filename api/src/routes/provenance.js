import { findProvenanceByChunkId } from '../db/queries/chunks.js'

export default async function provenanceRoutes(app) {
  app.get('/api/research/provenance/:chunk_id', async (request, reply) => {
    const { chunk_id } = request.params
    const tenantId = request.headers['x-tenant-id'] || 'ethikslabs'
    const provenance = await findProvenanceByChunkId(chunk_id, tenantId)
    if (!provenance) {
      return reply.status(404).send({ error: 'Chunk not found', code: 'CHUNK_NOT_FOUND' })
    }
    return reply.send({ chunk_id, provenance })
  })
}
