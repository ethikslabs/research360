import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { config } from '../config/env.js'

export const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })

export const queues = {
  extraction:  new Queue('extraction',  { connection: redis }),
  transform:   new Queue('transform',   { connection: redis }),
  chunk:       new Queue('chunk',       { connection: redis }),
  embedding:   new Queue('embedding',   { connection: redis }),
}

export async function healthCheck() {
  const result = await redis.ping()
  return result === 'PONG'
}
