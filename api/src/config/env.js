import 'dotenv/config'

// Required to start the server
const REQUIRED = [
  'DATABASE_URL',
  'REDIS_URL',
  'AWS_REGION',
  'S3_BUCKET',
  'PORT',
  'NODE_ENV',
]

// Only needed by Phase 2 workers — warn but don't block startup
const PHASE2 = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'UNSTRUCTURED_API_KEY']

function validateEnv() {
  const missing = REQUIRED.filter(key => !process.env[key])
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }

  const missingPhase2 = PHASE2.filter(k => !process.env[k])
  if (missingPhase2.length > 0) {
    console.warn(`[env] Phase 2 keys not set (workers will fail): ${missingPhase2.join(', ')}`)
  }

  return Object.freeze({
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    AWS_REGION: process.env.AWS_REGION,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ENDPOINT: process.env.S3_ENDPOINT || null,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || null,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null,
    UNSTRUCTURED_API_KEY: process.env.UNSTRUCTURED_API_KEY || null,
    PORT: parseInt(process.env.PORT, 10) || 3000,
    NODE_ENV: process.env.NODE_ENV,
  })
}

export const config = validateEnv()
export { validateEnv }
