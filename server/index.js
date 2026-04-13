/**
 * VISHESH SOMPURA AI — Backend Server
 * ─────────────────────────
 * Pipeline: Audio → Shuka/Saarika STT → Sarvam-M LLM → Indic Parler-TTS (or Bulbul fallback)
 *
 * All Sarvam API calls use direct fetch to avoid SDK version issues.
 * Required env vars: SARVAM_API_KEY
 * Optional:          PARLER_TTS_URL (local Indic Parler-TTS Python service)
 */

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

const app = express()
const PORT = Number(process.env.PORT || 8787)

const SARVAM_API_KEY = process.env.SARVAM_API_KEY || ''
const SARVAM_BASE = 'https://api.sarvam.ai'

// Correct Sarvam model names
const STT_MODEL = process.env.SARVAM_STT_MODEL || 'saarika:v2'      // Shuka-family STT
const TTS_MODEL = process.env.SARVAM_TTS_MODEL || 'bulbul:v1'       // Sarvam TTS fallback
const LLM_MODEL = process.env.SARVAM_LLM_MODEL || 'sarvam-m'        // Sarvam LLM

// Optional Indic Parler-TTS Python sidecar URL (e.g. http://localhost:8000)
const PARLER_TTS_URL = (process.env.PARLER_TTS_URL || '').replace(/\/$/, '')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
})

app.use(cors({ origin: true }))
app.use(express.json({ limit: '2mb' }))

/* ─────────────────── helpers ─────────────────── */

/** Sarvam API request headers */
function sarvamHeaders(extra = {}) {
  return {
    'api-subscription-key': SARVAM_API_KEY,
    ...extra,
  }
}

function cleanText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
}

function parseHistory(raw) {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: cleanText(m.content) }))
      .slice(-16)
  } catch { return [] }
}

/** Write buffer to a temp file and return the path */
async function writeTempFile(buffer, ext = '.webm') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vsai-'))
  const file = path.join(dir, `${randomUUID()}${ext}`)
  await fs.writeFile(file, buffer)
  return { file, dir }
}

async function cleanupTemp({ file, dir }) {
  try { await fs.unlink(file) } catch { }
  try { await fs.rm(dir, { recursive: true, force: true }) } catch { }
}

function fallbackReply(lang) {
  return /hi|mr|gu|bn|ta|te|kn|pa|ur/i.test(lang || '')
    ? 'ठीक है, मैं सुन रहा हूँ।'
    : 'I am ready. How can I help you?'
}

/* ─────────────────── Sarvam STT (Shuka / Saarika) ─────────────────── */

async function transcribeAudio(buffer, originalName = 'audio.webm') {
  const ext = path.extname(originalName) || '.webm'
  const tmp = await writeTempFile(buffer, ext)

  try {
    // Read file back as Blob for fetch FormData
    const fileBuffer = await fs.readFile(tmp.file)
    const mimeType = ext === '.mp4' ? 'audio/mp4' : 'audio/webm'
    const audioBlob = new Blob([fileBuffer], { type: mimeType })

    const form = new FormData()
    form.append('file', audioBlob, `audio${ext}`)
    form.append('model', STT_MODEL)
    form.append('language_code', 'unknown')   // auto-detect all Indian languages
    form.append('with_timestamps', 'false')

    const res = await fetch(`${SARVAM_BASE}/speech-to-text`, {
      method: 'POST',
      headers: sarvamHeaders(),
      body: form,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      const msg = err?.error?.message || err?.error || err?.detail || err?.message || `STT HTTP ${res.status}`
      console.error('[Sarvam STT] Error response:', msg)
      throw new Error(msg)
    }

    const data = await res.json()
    return {
      transcript: cleanText(data?.transcript || data?.text || ''),
      languageCode: data?.language_code || 'hi-IN',
    }
  } finally {
    await cleanupTemp(tmp)
  }
}

/* ─────────────────── Sarvam LLM (sarvam-m) ─────────────────── */

async function generateReply({ transcript, history, languageCode }) {
  const system = `You are VISHESH SOMPURA AI — a warm, helpful Indian voice assistant built with Shuka S2S and Indic Parler-TTS.
Always reply in the SAME language, script, and code-mixing style the user used (Hindi, Tamil, Telugu, Gujarati, Hinglish, etc.).
Keep your answer SHORT and natural for speech — avoid bullet points, markdown, or long paragraphs.
Sound conversational, warm, and Indian.`

  const messages = [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: transcript },
  ]

  const res = await fetch(`${SARVAM_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: sarvamHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      temperature: 0.75,
      top_p: 0.95,
      max_tokens: 240,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || err?.detail || `LLM HTTP ${res.status}`)
  }

  const data = await res.json()
  let raw = data?.choices?.[0]?.message?.content || ''
  // Strip <think>...</think> chain-of-thought blocks (handles multiline)
  raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
  // Fallback: if there's an unclosed <think> tag, strip from <think> to end
  raw = raw.replace(/<think>[\s\S]*/gi, '')
  const reply = cleanText(raw)
  return reply || fallbackReply(languageCode)
}

/* ─────────────────── TTS: Indic Parler-TTS sidecar ─────────────────── */

async function parlerTTS({ text, languageCode, style }) {
  const res = await fetch(`${PARLER_TTS_URL}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, languageCode, style }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.detail || err?.message || `Parler TTS HTTP ${res.status}`)
  }

  const data = await res.json()
  return {
    base64: data.audioBase64,
    mimeType: data.mimeType || 'audio/wav',
    provider: 'parler-indic',
  }
}

/* ─────────────────── TTS: Sarvam Bulbul (fallback) ─────────────────── */

// Bulbul v3 compatible speakers only
const SPEAKER_MAP = {
  'hi': 'priya', 'ta': 'kavitha', 'te': 'shreya',
  'bn': 'ishita', 'gu': 'kavya', 'mr': 'pooja',
  'kn': 'roopa', 'ml': 'rupali', 'pa': 'simran',
  'od': 'neha', 'ur': 'ritu', 'en': 'shubh',
}

function normLang(lc) {
  const l = String(lc || '').toLowerCase()
  const map = {
    hi: 'hi-IN', bn: 'bn-IN', gu: 'gu-IN', kn: 'kn-IN',
    ml: 'ml-IN', mr: 'mr-IN', od: 'od-IN', pa: 'pa-IN',
    ta: 'ta-IN', te: 'te-IN', ur: 'ur-IN'
  }
  const prefix = l.slice(0, 2)
  return map[prefix] || 'hi-IN'
}

async function sarvamTTS({ text, languageCode }) {
  const targetLang = normLang(languageCode)
  const speaker = SPEAKER_MAP[targetLang.slice(0, 2)] || 'aditya'

  const res = await fetch(`${SARVAM_BASE}/text-to-speech`, {
    method: 'POST',
    headers: sarvamHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      text,
      target_language_code: targetLang,
      speaker,
      model: TTS_MODEL,
      enable_preprocessing: true,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = err?.error?.message || err?.detail || err?.message || JSON.stringify(err)
    console.error('[Sarvam TTS] Error response:', msg)
    throw new Error(msg || `TTS HTTP ${res.status}`)
  }

  const data = await res.json()
  const audio = Array.isArray(data?.audios) ? data.audios[0] : null
  if (!audio) throw new Error('Sarvam TTS returned no audio')

  return {
    base64: audio,
    mimeType: 'audio/wav',
    provider: 'sarvam-bulbul',
  }
}

/* ─────────────────── Unified synthesize ─────────────────── */

async function synthesize({ text, languageCode, preferParler = true }) {
  // Try Indic Parler-TTS first (better Indian voice quality)
  if (preferParler && PARLER_TTS_URL) {
    try {
      return await parlerTTS({
        text,
        languageCode,
        style: 'warm friendly conversational Indian voice',
      })
    } catch (e) {
      console.warn('[Parler] Falling back to Sarvam TTS:', e.message)
    }
  }
  // Fallback: Sarvam Bulbul
  return await sarvamTTS({ text, languageCode })
}

/* ─────────────────── Routes ─────────────────── */

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    sttModel: STT_MODEL,
    llmModel: LLM_MODEL,
    ttsModel: TTS_MODEL,
    parlerConfigured: Boolean(PARLER_TTS_URL),
    sarvamConfigured: Boolean(SARVAM_API_KEY),
  })
})

app.post('/api/turn', upload.single('audio'), async (req, res) => {
  if (!SARVAM_API_KEY) {
    return res.status(500).json({ error: 'SARVAM_API_KEY is not set on the server.' })
  }

  try {
    const textInput = cleanText(req.body?.text || '')
    const history = parseHistory(req.body?.history)
    const useParler = String(req.body?.ttsProvider || 'parler').toLowerCase() !== 'sarvam'

    let transcript = textInput
    let languageCode = req.body?.languageCode || ''

    /* ── Step 1: Speech-to-Text (Shuka / Saarika) ── */
    if (!transcript && req.file?.buffer?.length) {
      const sttResult = await transcribeAudio(req.file.buffer, req.file.originalname || 'audio.webm')
      transcript = sttResult.transcript
      languageCode = sttResult.languageCode
    }

    if (!transcript) {
      // No speech detected (silence) — return empty result so frontend keeps listening
      return res.json({ transcript: '', reply: '', languageCode: '', silence: true })
    }

    /* ── Step 2: LLM reply (Sarvam-M) ── */
    const reply = await generateReply({ transcript, history, languageCode })

    /* ── Step 3: TTS (Indic Parler-TTS → Sarvam Bulbul fallback) ── */
    const audio = await synthesize({ text: reply, languageCode, preferParler: useParler })

    res.json({
      transcript,
      reply,
      languageCode,
      audioBase64: audio.base64,
      audioMimeType: audio.mimeType,
      audioProvider: audio.provider,
    })
  } catch (err) {
    console.error('[/api/turn]', err)
    res.status(500).json({ error: err?.message || 'Internal server error' })
  }
})

app.listen(PORT, () => {
  console.log(`\n🎙️  VISHESH SOMPURA AI backend  →  http://localhost:${PORT}`)
  console.log(`   STT model:  ${STT_MODEL} (Shuka/Saarika)`)
  console.log(`   LLM model:  ${LLM_MODEL}`)
  console.log(`   TTS:        ${PARLER_TTS_URL ? `Parler @ ${PARLER_TTS_URL}` : 'Sarvam Bulbul (Parler not configured)'}`)
  if (!SARVAM_API_KEY) {
    console.warn('\n⚠️  SARVAM_API_KEY not set — requests will fail\n')
  }
})