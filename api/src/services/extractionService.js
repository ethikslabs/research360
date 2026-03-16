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

async function extractDocument(document) {
  const buffer = await download(document.tenant_id, document.id, 'original')

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
    return elements.map(e => e.text).filter(Boolean).join('\n\n')
  }

  // Local fallback — pdf-parse for PDFs
  const ext = (document.file_type || '').toLowerCase()
  if (ext === 'pdf') {
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default
    const data = await pdfParse(buffer)
    return data.text
  }

  // For DOCX/PPTX without Unstructured — extract raw text best-effort
  return buffer.toString('utf8').replace(/[^\x20-\x7E\n]/g, ' ').replace(/\s+/g, ' ').trim()
}

async function extractUrl(document) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(document.source_url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const text = await page.evaluate(() => {
      const article = document.querySelector('article') || document.body
      return article.innerText
    })
    return text
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
      const { stdout } = await execFileAsync('whisper', [audioPath, '--output_format', 'txt', '--output_dir', tmpDir])
      const txtPath = audioPath.replace('.mp3', '.txt')
      return await readFile(txtPath, 'utf8')
    } catch {
      // Fallback to OpenAI Whisper API
      const { createReadStream } = await import('fs')
      const transcript = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file: createReadStream(audioPath),
      })
      return transcript.text
    }
  } finally {
    await unlink(audioPath).catch(() => {})
  }
}

export async function extract(document) {
  console.log(JSON.stringify({ stage: 'extraction', document_id: document.id, source_type: document.source_type, timestamp: new Date().toISOString() }))

  switch (document.source_type) {
    case 'document': return extractDocument(document)
    case 'url':      return extractUrl(document)
    case 'youtube':  return extractYoutube(document)
    default: throw new Error(`Unknown source_type: ${document.source_type}`)
  }
}
