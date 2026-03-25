import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import OpenAI from 'openai'
import { config } from '../config/env.js'
import { download } from './s3Service.js'

const execFileAsync = promisify(execFile)
const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY })

/** Default confidence when derivation signals are unavailable. */
const DEFAULT_CONFIDENCE = 0.75

/**
 * Derive extraction confidence from Unstructured.io element metadata.
 * Uses element-level signals: OCR confidence, table detection fidelity.
 * Falls back to DEFAULT_CONFIDENCE when no usable signals are present.
 */
function deriveUnstructuredConfidence(elements) {
  if (!Array.isArray(elements) || elements.length === 0) return DEFAULT_CONFIDENCE

  const scores = elements
    .map(el => el.metadata?.detection_class_prob ?? el.metadata?.confidence ?? null)
    .filter(s => s !== null && s !== undefined && !isNaN(s))

  if (scores.length === 0) return DEFAULT_CONFIDENCE

  const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length
  return Math.max(0, Math.min(1, avg))
}

/**
 * Derive extraction confidence from Playwright page signals.
 * Uses content-to-boilerplate ratio as a proxy for extraction quality.
 * Falls back to DEFAULT_CONFIDENCE when signals are unavailable.
 */
function derivePlaywrightConfidence(text, bodyLen, articleLen) {
  if (!text || bodyLen === 0) return DEFAULT_CONFIDENCE

  // Content-to-boilerplate ratio: higher means cleaner extraction
  const ratio = articleLen / bodyLen
  // Scale: ratio >= 0.5 → high confidence, ratio < 0.2 → low confidence
  const confidence = 0.60 + ratio * 0.40
  return Math.max(0, Math.min(1, confidence))
}

/**
 * Derive extraction confidence from API response schema completeness.
 * Parses JSON and computes ratio of non-null, non-empty fields.
 * Falls back to DEFAULT_CONFIDENCE for non-JSON or parse failures.
 */
function deriveApiConfidence(text) {
  try {
    const parsed = JSON.parse(text)
    const entries = Object.entries(parsed)
    if (entries.length === 0) return DEFAULT_CONFIDENCE
    const nonNull = entries.filter(([, v]) => v !== null && v !== undefined && v !== '').length
    return Math.max(0, Math.min(1, nonNull / entries.length))
  } catch {
    return DEFAULT_CONFIDENCE
  }
}

async function extractDocument(document) {
  const buffer = await download(document.tenant_id, document.id, 'original')
  const ext = (document.file_type || '').toLowerCase()

  // Use Unstructured.io if key is available, otherwise fall back to local extraction
  if (config.UNSTRUCTURED_API_KEY && config.UNSTRUCTURED_API_KEY !== 'not-set') {
    const form = new FormData()
    form.append('files', new Blob([buffer]), document.file_name)
    const res = await fetch('https://api.unstructuredapp.io/general/v0/general', {
      method: 'POST',
      headers: { 'unstructured-api-key': config.UNSTRUCTURED_API_KEY, 'Accept': 'application/json' },
      body: form,
    })
    if (!res.ok) throw new Error(`Unstructured API error: ${res.status}`)
    const elements = await res.json()
    const text = elements.map(e => e.text).filter(Boolean).join('\n\n')

    // Derive confidence from Unstructured.io element-level signals.
    // Elements with high OCR confidence and good table fidelity push the score up.
    // Fallback to 0.90 when element metadata doesn't include confidence signals.
    const extraction_confidence = deriveUnstructuredConfidence(elements)

    return {
      text,
      extraction_confidence,
      extraction_method: 'unstructured_io',
      // PPTX converted by Unstructured — surface for metadata write-back
      ...(ext === 'pptx' ? { extra_metadata: { converted_from: 'pptx' } } : {}),
    }
  }

  // Local fallback — pdf-parse for PDFs
  if (ext === 'pdf') {
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default
    const data = await pdfParse(buffer)
    return { text: data.text, extraction_confidence: 0.75, extraction_method: 'pdf_parse' }
  }

  // DOCX/PPTX are ZIP containers — buffer.toString('utf8') produces binary noise.
  // Without Unstructured, these formats cannot be safely extracted locally.
  // Fail explicitly so the document is flagged rather than poisoning the corpus.
  if (ext === 'docx' || ext === 'pptx') {
    throw new Error(
      `Cannot extract ${ext.toUpperCase()} without UNSTRUCTURED_API_KEY. ` +
      `Set the key in your environment or convert the file to PDF before ingesting.`
    )
  }

  throw new Error(`Unsupported file type for local extraction: ${ext}`)
}

async function extractUrl(doc) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(doc.source_url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const { text, bodyLen, articleLen } = await page.evaluate(() => {
      const body = document.body
      const article = document.querySelector('article') || body
      return {
        text: article.innerText,
        bodyLen: (body.innerText || '').length,
        articleLen: (article.innerText || '').length,
      }
    })

    // Derive confidence from Playwright signals:
    // - JS render success (we got here, so it succeeded)
    // - Content-to-boilerplate ratio: article text vs full body text
    const extraction_confidence = derivePlaywrightConfidence(text, bodyLen, articleLen)

    return { text, extraction_confidence, extraction_method: 'playwright' }
  } finally {
    await browser.close()
  }
}

async function extractYoutube(document) {
  const tmpDir = tmpdir()
  const outTemplate = join(tmpDir, `${randomUUID()}.%(ext)s`)

  // Download audio with yt-dlp
  await execFileAsync('yt-dlp', [
    '-x', '--audio-format', 'mp3',
    '-o', outTemplate,
    document.source_url,
  ])

  const audioPath = outTemplate.replace('%(ext)s', 'mp3')

  try {
    // Try local whisper first, fall back to OpenAI API
    try {
      await execFileAsync('whisper', [audioPath, '--output_format', 'txt', '--output_dir', tmpDir])
      const txtPath = audioPath.replace('.mp3', '.txt')
      const text = await readFile(txtPath, 'utf8')
      return { text, extraction_confidence: 0.85, extraction_method: 'whisper' }
    } catch {
      // Fallback to OpenAI Whisper API
      const { createReadStream } = await import('fs')
      const transcript = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file: createReadStream(audioPath),
      })
      return { text: transcript.text, extraction_confidence: 0.85, extraction_method: 'whisper' }
    }
  } finally {
    await unlink(audioPath).catch(() => {})
  }
}

async function extractApi(document) {
  // API sources (json_api / xml_api) — the raw response is already stored in S3
  // by the ingest route. We retrieve it and compute schema completeness confidence.
  const buffer = await download(document.tenant_id, document.id, 'original')
  const text = buffer.toString('utf8')

  // Derive confidence from schema completeness: ratio of non-null, non-empty fields.
  const extraction_confidence = deriveApiConfidence(text)

  return { text, extraction_confidence, extraction_method: 'api_response' }
}

export async function extract(document) {
  console.log(JSON.stringify({ stage: 'extraction', document_id: document.id, source_type: document.source_type, timestamp: new Date().toISOString() }))

  switch (document.source_type) {
    case 'document': return extractDocument(document)
    case 'url':      return extractUrl(document)
    case 'youtube':  return extractYoutube(document)
    case 'api':      return extractApi(document)
    default: throw new Error(`Unknown source_type: ${document.source_type}`)
  }
}

// Exported for testing
export { deriveUnstructuredConfidence, derivePlaywrightConfidence, deriveApiConfidence, DEFAULT_CONFIDENCE }
