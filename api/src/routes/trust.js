import { findRunById, findRunProvenance } from '../db/queries/trustRuns.js'
import { findEventsByRunId } from '../db/queries/trustRunEvents.js'

export default async function trustRoutes(app) {
  // trust_runs is append-only — mutations rejected at route layer (DB trigger is primary enforcement)
  const MUTATION_REJECTED = { error: 'trust_runs is append-only. Updates and deletes are not permitted.', code: 'TRUST_RUN_IMMUTABLE' }

  app.put('/api/trust/runs/:run_id',    async (_, reply) => reply.status(405).send(MUTATION_REJECTED))
  app.patch('/api/trust/runs/:run_id',  async (_, reply) => reply.status(405).send(MUTATION_REJECTED))
  app.delete('/api/trust/runs/:run_id', async (_, reply) => reply.status(405).send(MUTATION_REJECTED))

  app.get('/api/trust/runs/:run_id/provenance', async (request, reply) => {
    const { run_id } = request.params
    const result = await findRunProvenance(run_id)
    if (!result) {
      return reply.status(404).send({ error: 'Trust run not found', code: 'RUN_NOT_FOUND' })
    }
    return reply.send(result)
  })

  app.get('/api/trust/runs/:run_id/events', async (request, reply) => {
    const { run_id } = request.params
    const run = await findRunById(run_id)
    if (!run) {
      return reply.status(404).send({ error: 'Trust run not found', code: 'RUN_NOT_FOUND' })
    }
    const events = await findEventsByRunId(run_id)
    return reply.send({ run_id, events })
  })
}
