import { retrieve } from '../services/retrievalService.js'
import { reason } from '../services/reasoningService.js'
import { insert, findById, appendHistory } from '../db/queries/sessions.js'

const DEFAULT_TENANT = 'ethikslabs'

export default async function queryRoutes(app) {
  app.post('/research360/query', async (request, reply) => {
    const {
      query,
      tenant_id = DEFAULT_TENANT,
      persona = 'strategist',
      complexity = 'detailed',
      session_id,
      filters = {},
    } = request.body || {}

    if (!query?.trim()) {
      return reply.status(400).send({ error: 'query is required', code: 'MISSING_QUERY' })
    }

    // Load or create session
    let session
    if (session_id) {
      session = await findById(session_id, tenant_id)
      if (!session) return reply.status(404).send({ error: 'Session not found', code: 'SESSION_NOT_FOUND' })
    } else {
      session = await insert(tenant_id)
    }

    const history = session.history || []

    // Retrieve relevant chunks
    const chunks = await retrieve({ query, tenantId: tenant_id, complexity, filters })

    // Run reasoning
    const result = await reason({ query, chunks, persona, complexity, history })

    // Save turn to session history
    const userTurn = { role: 'user', content: query, timestamp: new Date().toISOString() }
    const assistantTurn = { role: 'assistant', content: result.answer, persona, timestamp: new Date().toISOString() }
    await appendHistory(session.id, userTurn)
    await appendHistory(session.id, assistantTurn)

    return reply.send({
      answer: result.answer,
      persona,
      complexity,
      session_id: session.id,
      sources: result.sources.map(s => ({
        document_id: s.document_id,
        document_title: s.document_title,
        source_type: s.source_type,
        source_url: s.source_url,
        chunk_id: s.chunk_id,
        chunk_text: s.chunk_text,
        chunk_index: s.chunk_index,
        relevance_score: s.relevance_score,
      })),
      suggestions: result.suggestions,
    })
  })

  app.get('/research360/sessions/:id', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] || DEFAULT_TENANT
    const session = await findById(request.params.id, tenantId)
    if (!session) return reply.status(404).send({ error: 'Session not found', code: 'SESSION_NOT_FOUND' })
    return reply.send({ session_id: session.id, history: session.history })
  })
}
