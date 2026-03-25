import { refresh } from '../services/refreshService.js'

const DEFAULT_TENANT = 'ethikslabs'

export default async function researchRoutes(app) {
  app.post('/api/research/refresh', async (request, reply) => {
    const {
      chunk_ids,
      source_uris,
      canonical_uris,
      reason,
      company_id,
      run_id,
      tenant_id = DEFAULT_TENANT,
    } = request.body || {}

    if (!chunk_ids?.length && !source_uris?.length && !canonical_uris?.length) {
      return reply.status(400).send({
        error: 'At least one of chunk_ids, source_uris, or canonical_uris is required',
        code: 'MISSING_SCOPE',
      })
    }

    const result = await refresh({
      tenantId:      tenant_id,
      chunkIds:      chunk_ids,
      sourceUris:    source_uris,
      canonicalUris: canonical_uris,
      reason,
      companyId:     company_id,
      runId:         run_id,
    })

    return reply.send(result)
  })
}
