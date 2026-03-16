import 'dotenv/config'
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
import { config } from './config/env.js'

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

async function start() {
  await initialize()
  startExtractionWorker()
  startTransformWorker()
  startChunkWorker()
  startEmbeddingWorker()
  await app.listen({ port: config.PORT, host: '0.0.0.0' })
}

start().catch(err => {
  console.error(err)
  process.exit(1)
})

export default app
