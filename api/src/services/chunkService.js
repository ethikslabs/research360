import { createHash } from 'crypto'
import { get_encoding } from 'tiktoken'

const enc = get_encoding('cl100k_base')
const TARGET_TOKENS = 700
const OVERLAP_TOKENS = Math.floor(TARGET_TOKENS * 0.15)

function hashText(text) {
  return createHash('sha256').update(text).digest('hex')
}

export function chunk(text) {
  const tokens = enc.encode(text)
  const decoder = new TextDecoder()
  const chunks = []
  let start = 0

  while (start < tokens.length) {
    const end = Math.min(start + TARGET_TOKENS, tokens.length)
    const slice = tokens.slice(start, end)
    const chunkText = decoder.decode(enc.decode(slice)).trim()

    if (chunkText) {
      chunks.push({
        chunk_text: chunkText,
        chunk_index: chunks.length,
        chunk_hash: hashText(chunkText),
        token_count: slice.length,
      })
    }

    const next = end - OVERLAP_TOKENS
    if (next <= start) break
    start = next
  }

  return chunks
}
