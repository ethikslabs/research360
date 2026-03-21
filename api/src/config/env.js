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

// Required for core features (embedding, reasoning, document extraction).
// Workers start unconditionally — missing keys cause runtime failures, not startup failures.
// This is intentional for local dev without all services, but must be understood.
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
    // Discovery agent constants
    AUTO_INGEST_THRESHOLD: parseFloat(process.env.AUTO_INGEST_THRESHOLD) || 0.85,
    REVIEW_THRESHOLD: parseFloat(process.env.REVIEW_THRESHOLD) || 0.60,
    VENDOR_STALENESS_DAYS: parseInt(process.env.VENDOR_STALENESS_DAYS, 10) || 30,
    HORIZON_LOOKBACK_HOURS: parseInt(process.env.HORIZON_LOOKBACK_HOURS, 10) || 24,
    DISCOVERY_MAX_CANDIDATES: parseInt(process.env.DISCOVERY_MAX_CANDIDATES, 10) || 20,
    DISCOVERY_MAX_GAP: parseInt(process.env.DISCOVERY_MAX_GAP, 10) || 8,
    DISCOVERY_MAX_STALENESS: parseInt(process.env.DISCOVERY_MAX_STALENESS, 10) || 6,
    DISCOVERY_MAX_HORIZON: parseInt(process.env.DISCOVERY_MAX_HORIZON, 10) || 6,
    DEDUPE_LOOKBACK_DAYS: parseInt(process.env.DEDUPE_LOOKBACK_DAYS, 10) || 30,
  })
}

export const config = validateEnv()
export { validateEnv }
