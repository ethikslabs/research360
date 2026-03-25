import { Worker } from 'bullmq'
import { redis } from '../queue/client.js'
import { runStaleScan } from '../services/staleCronService.js'

export function startStaleWorker() {
  const worker = new Worker('stale', async () => {
    await runStaleScan()
  }, {
    connection: redis,
    concurrency: 1,
  })

  worker.on('failed', (job, err) => {
    console.log(JSON.stringify({ stage: 'stale_worker_failed', error: err.message }))
  })

  return worker
}
