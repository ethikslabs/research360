import 'dotenv/config'
import { createConnection } from 'node:net'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import cors from '@fastify/cors'
import { initialize } from './db/client.js'
import healthRoutes from './routes/health.js'
import ingestRoutes from './routes/ingest.js'
import documentRoutes from './routes/documents.js'
import queryRoutes from './routes/query.js'
import { startExtractionWorker } from './workers/extractionWorker.js'
import { startTransformWorker } from './workers/transformWorker.js'
import { startChunkWorker } from './workers/chunkWorker.js'
import { startEmbeddingWorker } from './workers/embeddingWorker.js'
import { startDiscoveryWorker } from './workers/discovery-worker.js'
import { startStaleWorker } from './workers/stale-worker.js'
import { config } from './config/env.js'
import discoveryRoutes from './routes/discovery.js'
import researchRoutes from './routes/research.js'
import provenanceRoutes from './routes/provenance.js'
import trustRoutes from './routes/trust.js'
import { queues } from './queue/client.js'

const app = Fastify({
  logger: {
    level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    transport:
      config.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } }
        : undefined,
  },
})

app.register(cors, { origin: true })
app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } })

app.setErrorHandler((error, request, reply) => {
  const statusCode = error.statusCode || 500
  const code = error.code || 'INTERNAL_ERROR'
  const message = error.message || 'An unexpected error occurred'
  request.log.error({ err: error, code }, message)
  reply.status(statusCode).send({ error: message, code })
})

app.setNotFoundHandler((request, reply) => {
  reply.status(404).send({
    error: `Route ${request.method} ${request.url} not found`,
    code: 'ROUTE_NOT_FOUND',
  })
})

app.register(healthRoutes)
app.register(ingestRoutes)
app.register(documentRoutes)
app.register(queryRoutes)
app.register(discoveryRoutes)
app.register(researchRoutes)
app.register(provenanceRoutes)
app.register(trustRoutes)

async function start() {
  await initialize()

  // Port guard
  await new Promise((resolve) => {
    const probe = createConnection({ port: config.PORT, host: 'localhost' })
    probe.once('connect', () => {
      probe.destroy()
      process.stderr.write(`[research360] Port ${config.PORT} already in use — kill it with: kill $(lsof -ti:${config.PORT})\n`)
      process.exit(1)
    })
    probe.once('error', () => {
      probe.destroy()
      resolve()
    })
  })

  await app.listen({ port: config.PORT, host: '0.0.0.0' })

  startExtractionWorker()
  startTransformWorker()
  startChunkWorker()
  startEmbeddingWorker()
  startDiscoveryWorker()
  startStaleWorker()

  // Schedule nightly discovery run at 02:00
  await queues.discovery.add(
    'nightly',
    { trigger: 'scheduled' },
    {
      repeat: { cron: '0 2 * * *' },
      jobId: 'discovery-nightly',
    }
  )
  console.log(JSON.stringify({ stage: 'discovery_scheduler', status: 'scheduled', cron: '0 2 * * *' }))

  // Schedule hourly stale detection scan
  await queues.stale.add(
    'hourly',
    { trigger: 'scheduled' },
    {
      repeat: { cron: '0 * * * *' },
      jobId: 'stale-hourly',
    }
  )
  console.log(JSON.stringify({ stage: 'stale_scheduler', status: 'scheduled', cron: '0 * * * *' }))
}

start().catch(err => {
  console.error(err)
  process.exit(1)
})

export default app
