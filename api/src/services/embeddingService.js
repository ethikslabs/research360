import OpenAI from 'openai'

const GATEWAY_URL = process.env.AI_GATEWAY_URL || 'http://localhost:3003/v1'
const openai = new OpenAI({ baseURL: GATEWAY_URL, apiKey: 'gateway', defaultHeaders: { 'X-Tenant-ID': 'research360' } })
const MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-large'
const BATCH_SIZE = 100

export async function embedTexts(texts) {
  const results = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const start = Date.now()
    const res = await openai.embeddings.create({ model: MODEL, input: batch })
    const latency = Date.now() - start
    console.log(JSON.stringify({
      stage: 'embedding',
      batch_size: batch.length,
      embedding_latency_ms: latency,
      token_usage: res.usage?.total_tokens,
    }))
    results.push(...res.data.map(d => d.embedding))
  }
  return results
}

export async function embedText(text) {
  const res = await embedTexts([text])
  return res[0]
}
