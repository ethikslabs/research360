// Re-queues all PENDING documents that have no active BullMQ jobs.
// Run from api/ directory: node requeue.mjs
import { Queue } from 'bullmq'
import { readFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'

const connection = { host: 'localhost', port: 6379 }
const extractionQueue = new Queue('extraction', { connection })

// Get pending IDs from API
let ids = []
try {
  const resp = execSync('curl -s "http://localhost:3001/research360/documents?limit=500"').toString()
  const data = JSON.parse(resp)
  const docs = data.documents || data
  ids = docs.filter(d => d.status === 'PENDING').map(d => d.id)
} catch (e) {
  console.error('Could not reach API — is it running?', e.message)
  process.exit(1)
}

if (ids.length === 0) {
  console.log('No PENDING documents found.')
} else {
  console.log(`Re-queuing ${ids.length} PENDING documents...`)
  for (const id of ids) {
    await extractionQueue.add('CONTENT_UPLOADED', {
      document_id: id,
      tenant_id: 'ethikslabs',
      timestamp: new Date().toISOString(),
      stage: 'CONTENT_UPLOADED'
    }, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } })
  }
  console.log('Done — restart the API to wake the workers.')
}

await extractionQueue.close()
