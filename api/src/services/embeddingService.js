import OpenAI from 'openai'
import { config } from '../config/env.js'

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY })
const MODEL = 'text-embedding-3-large'
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
