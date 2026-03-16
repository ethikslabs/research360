import { healthCheck as pgHealth } from '../db/client.js'
import { healthCheck as redisHealth } from '../queue/client.js'
import { healthCheck as s3Health } from '../services/s3Service.js'

export default async function healthRoutes(app) {
  app.get('/health', async (request, reply) => {
    const [postgres, redis, s3] = await Promise.allSettled([
      pgHealth(),
      redisHealth(),
      s3Health(),
    ])

    const result = {
      postgres: postgres.status === 'fulfilled' && postgres.value ? 'ok' : 'error',
      redis:    redis.status === 'fulfilled' && redis.value ? 'ok' : 'error',
      s3:       s3.status === 'fulfilled' && s3.value ? 'ok' : 'error',
    }

    result.status = Object.values(result).every(v => v === 'ok') ? 'ok' : 'degraded'
    return reply.send(result)
  })
}
