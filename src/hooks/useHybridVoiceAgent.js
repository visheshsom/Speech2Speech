/**
 * useHybridVoiceAgent
 * ────────────────────
 * Manages the full mic → server → speaker pipeline.
 * VISHESH SOMPURA backend (/api/turn).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/* ── Constants ─────────────────────────────────────────── */

const MIC_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
]

// VAD (Voice Activity Detection) tuning
const SILENCE_THRESHOLD = 8       // avg frequency level below this = silence (0–255 scale)
const SILENCE_DURATION_MS = 3500  // ms of continuous silence before auto-stop
const MIN_RECORD_MS = 1500        // don't auto-stop before this (avoids false starts)
const MAX_RECORD_MS = 25000       // hard cap - Sarvam STT limit is 30s
const VAD_POLL_MS = 150           // how often to check mic levels

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  return MIC_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || ''
}

function base64ToBlob(base64, mimeType = 'audio/wav') {
  const chars = atob(base64)
  const arrays = []
  for (let i = 0; i < chars.length; i += 1024) {
    const slice = chars.slice(i, i + 1024)
    arrays.push(new Uint8Array([...slice].map((c) => c.charCodeAt(0))))
  }
  return new Blob(arrays, { type: mimeType })
}

async function safeJson(response) {
  const text = await response.text()
  try { return text ? JSON.parse(text) : {} }
  catch { return { raw: text } }
}

/**
 * @param {object} opts
 * @param {string}   opts.backendUrl    
 * @param {boolean}  opts.autoListen    
 * @param {Function} opts.onError       
 * @param {Function} opts.onStateChange 
 * @param {Function} opts.onTurnComplete
 */
export function useHybridVoiceAgent({
  backendUrl = '/api',
  autoListen = true,
  onError,
  onStateChange,
  onTurnComplete,
} = {}) {
  const [state, setState] = useState('idle')
  const [sessionActive, setSessionActive] = useState(false)
  const [analyser, setAnalyser] = useState(null)
  const [lastTurn, setLastTurn] = useState(null)

  // refs that survive re-renders without stale closure issues
  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const sessionRef = useRef(false)
  const activeTurnRef = useRef(false)
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const gainRef = useRef(null)
  const playbackRef = useRef(null)
  const backendRef = useRef(backendUrl)
  const historyRef = useRef([])      // rolling conversation
  const stateRef = useRef('idle')
  const startRecRef = useRef(null)    // break circular dep
  const onErrorRef = useRef(onError)
  const onStateRef = useRef(onStateChange)
  const onTurnRef = useRef(onTurnComplete)
  const autoListenRef = useRef(autoListen)

  // VAD (silence detection) refs
  const vadIntervalRef = useRef(null)
  const maxRecordTimerRef = useRef(null)
  const micAnalyserRef = useRef(null)
  const micSourceRef = useRef(null)
  const recordStartTimeRef = useRef(0)

  // keep refs current on every render
  useEffect(() => { backendRef.current = backendUrl || '/api' }, [backendUrl])
  useEffect(() => { autoListenRef.current = autoListen }, [autoListen])
  useEffect(() => { onErrorRef.current = onError }, [onError])
  useEffect(() => { onStateRef.current = onStateChange }, [onStateChange])
  useEffect(() => { onTurnRef.current = onTurnComplete }, [onTurnComplete])

  /* ── state helper ─────────────────────────────────────── */

  const setAgentState = useCallback((next) => {
    stateRef.current = next
    setState(next)
    onStateRef.current?.(next)
  }, [])

  /* ── VAD cleanup helper ───────────────────────────────── */

  const stopVAD = useCallback(() => {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current)
      vadIntervalRef.current = null
    }
    if (maxRecordTimerRef.current) {
      clearTimeout(maxRecordTimerRef.current)
      maxRecordTimerRef.current = null
    }
  }, [])

  /* ── Web Audio graph (for VoiceOrb analyser) ──────────── */

  const ensureAudioGraph = useCallback(async () => {
    if (audioCtxRef.current) return audioCtxRef.current
    const Ctor = window.AudioContext || window.webkitAudioContext
    if (!Ctor) return null

    const ctx = new Ctor()
    const analyserNode = ctx.createAnalyser()
    analyserNode.fftSize = 256

    // silent oscillator keeps the analyser "warm" during idle
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 4
    gain.gain.value = 0.0001

    osc.connect(gain)
    gain.connect(analyserNode)
    analyserNode.connect(ctx.destination)
    osc.start()

    audioCtxRef.current = ctx
    analyserRef.current = analyserNode
    gainRef.current = gain
    setAnalyser(analyserNode)

    if (ctx.state === 'suspended') await ctx.resume()
    return ctx
  }, [])

  const pulseOn = useCallback(async () => {
    await ensureAudioGraph()
    const gain = gainRef.current
    const ctx = audioCtxRef.current
    if (!gain || !ctx) return
    const t = ctx.currentTime
    gain.gain.cancelScheduledValues(t)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.linearRampToValueAtTime(0.85, t + 0.18)
  }, [ensureAudioGraph])

  const pulseOff = useCallback(() => {
    const gain = gainRef.current
    const ctx = audioCtxRef.current
    if (!gain || !ctx) return
    const t = ctx.currentTime
    gain.gain.cancelScheduledValues(t)
    gain.gain.setValueAtTime(gain.gain.value, t)
    gain.gain.linearRampToValueAtTime(0.0001, t + 0.32)
  }, [])

  /* ── Playback ─────────────────────────────────────────── */

  const stopPlayback = useCallback(() => {
    const a = playbackRef.current
    if (a) { a.pause(); a.src = ''; playbackRef.current = null }
    pulseOff()
  }, [pulseOff])

  const playReply = useCallback(async (base64, mimeType = 'audio/wav') => {
    if (!base64) return
    const blob = base64ToBlob(base64, mimeType)
    const url = URL.createObjectURL(blob)
    stopPlayback()

    const audio = new Audio(url)
    playbackRef.current = audio
    setAgentState('speaking')
    await pulseOn()

    await new Promise((resolve) => {
      const done = () => {
        audio.removeEventListener('ended', done)
        audio.removeEventListener('error', done)
        URL.revokeObjectURL(url)
        playbackRef.current = null
        pulseOff()
        resolve()
      }
      audio.addEventListener('ended', done)
      audio.addEventListener('error', done)
      audio.play().catch(done)
    })
  }, [pulseOff, pulseOn, setAgentState, stopPlayback])

  /* ── Recorder ─────────────────────────────────────────── */

  const stopRecorder = useCallback(() => {
    stopVAD()
    const r = recorderRef.current
    if (r && r.state !== 'inactive') r.stop()
  }, [stopVAD])

  /* ── Server request ───────────────────────────────────── */

  const sendRequest = useCallback(async ({ text, audioBlob }) => {
    const form = new FormData()
    if (text) form.append('text', text)
    if (audioBlob) form.append('audio', audioBlob, `turn-${Date.now()}.webm`)

    form.append('history', JSON.stringify(historyRef.current.slice(-14)))
    form.append('ttsProvider', localStorage.getItem('vs_tts_provider') || 'parler')

    const url = `${backendRef.current.replace(/\/$/, '')}/turn`
    const res = await fetch(url, { method: 'POST', body: form })
    const data = await safeJson(res)

    if (!res.ok) {
      throw new Error(data?.error?.message || data?.error || data?.raw || `HTTP ${res.status}`)
    }
    return data
  }, [])

  /* ── Process turn response ────────────────────────────── */

  const processTurn = useCallback(async (data) => {
    // Silence detected — no speech in the recording, just re-listen
    if (data?.silence && !data?.transcript) {
      if (sessionRef.current && autoListenRef.current) {
        setAgentState('listening')
        await startRecRef.current?.()
      }
      return
    }

    const turn = {
      transcript: data?.transcript || '',
      reply: data?.reply || '',
      languageCode: data?.languageCode || '',
      audioProvider: data?.audioProvider || '',
    }

    if (turn.transcript) historyRef.current.push({ role: 'user', content: turn.transcript })
    if (turn.reply) historyRef.current.push({ role: 'assistant', content: turn.reply })
    // keep rolling window
    if (historyRef.current.length > 20) historyRef.current = historyRef.current.slice(-20)

    setLastTurn(turn)
    onTurnRef.current?.(turn)

    if (data?.audioBase64) {
      await playReply(data.audioBase64, data.audioMimeType || 'audio/wav')
    }

    if (!sessionRef.current) return

    if (autoListenRef.current) {
      setAgentState('listening')
      await startRecRef.current?.()
    } else {
      sessionRef.current = false
      historyRef.current = []
      setSessionActive(false)
      setAgentState('idle')
    }
  }, [playReply, setAgentState])

  /* ── Silence detection (VAD) ──────────────────────────── */

  const startVAD = useCallback(() => {
    const ctx = audioCtxRef.current
    const stream = streamRef.current
    if (!ctx || !stream) return

    // Create a separate analyser for mic input (not the orb visual one)
    if (!micAnalyserRef.current) {
      const micAnalyser = ctx.createAnalyser()
      micAnalyser.fftSize = 256
      micAnalyserRef.current = micAnalyser
    }

    // Connect mic stream → analyser (disconnect old source first)
    if (micSourceRef.current) {
      try { micSourceRef.current.disconnect() } catch { /* ok */ }
    }
    const source = ctx.createMediaStreamSource(stream)
    source.connect(micAnalyserRef.current)
    micSourceRef.current = source

    const analyser = micAnalyserRef.current
    const bufLen = analyser.frequencyBinCount
    const freqData = new Uint8Array(bufLen)
    let silenceStart = null

    recordStartTimeRef.current = Date.now()

    // Poll mic levels to detect silence
    vadIntervalRef.current = setInterval(() => {
      // Don't auto-stop if recorder is no longer recording
      const r = recorderRef.current
      if (!r || r.state !== 'recording') {
        stopVAD()
        return
      }

      const elapsed = Date.now() - recordStartTimeRef.current

      // Don't trigger silence detection in the first MIN_RECORD_MS
      if (elapsed < MIN_RECORD_MS) return

      analyser.getByteFrequencyData(freqData)
      const avg = freqData.reduce((a, b) => a + b, 0) / bufLen

      if (avg < SILENCE_THRESHOLD) {
        if (!silenceStart) silenceStart = Date.now()
        else if (Date.now() - silenceStart >= SILENCE_DURATION_MS) {
          // Silence confirmed — auto-stop recording
          stopVAD()
          if (r && r.state === 'recording') r.stop()
        }
      } else {
        silenceStart = null // speech detected, reset
      }
    }, VAD_POLL_MS)

    // Hard safety net — never exceed MAX_RECORD_MS
    maxRecordTimerRef.current = setTimeout(() => {
      const r = recorderRef.current
      if (r && r.state === 'recording') {
        stopVAD()
        r.stop()
      }
    }, MAX_RECORD_MS)
  }, [stopVAD])

  /* ── Recording ────────────────────────────────────────── */

  const startRecording = useCallback(async () => {
    if (activeTurnRef.current) return
    activeTurnRef.current = true

    try {
      await ensureAudioGraph()

      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      }

      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(
        streamRef.current,
        mimeType ? { mimeType } : undefined,
      )
      recorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stopVAD() // ensure VAD is cleaned up
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        chunksRef.current = []
        activeTurnRef.current = false

        if (!sessionRef.current || blob.size < 100) return

        setAgentState('processing')
        try {
          const result = await sendRequest({ audioBlob: blob })
          await processTurn(result)
        } catch (err) {
          const msg = err?.message || 'Turn failed.'
          onErrorRef.current?.(msg)
          // Stop session on silence / no-audio errors — no point re-listening
          const isNoAudio = /no audio|no.?text/i.test(msg)
          if (isNoAudio || !sessionRef.current) {
            sessionRef.current = false
            setSessionActive(false)
            streamRef.current?.getTracks()?.forEach((t) => t.stop())
            streamRef.current = null
            setAgentState('idle')
          } else {
            setAgentState('listening')
            activeTurnRef.current = false
          }
        }
      }

      recorder.onerror = (e) => {
        stopVAD()
        activeTurnRef.current = false
        onErrorRef.current?.(e?.error?.message || 'Recording error.')
        setAgentState('error')
      }

      recorder.start()
      setAgentState('listening')
      await pulseOn()

      // Start silence detection — auto-stops recording after silence
      startVAD()
    } catch (err) {
      activeTurnRef.current = false
      throw err
    }
  }, [ensureAudioGraph, processTurn, pulseOn, sendRequest, setAgentState, startVAD, stopVAD])

  useEffect(() => { startRecRef.current = startRecording }, [startRecording])

  /* ── Session control ──────────────────────────────────── */

  const startSession = useCallback(async () => {
    if (sessionRef.current) return
    sessionRef.current = true
    historyRef.current = []
    setSessionActive(true)
    onErrorRef.current?.('')
    try {
      await startRecording()
    } catch (err) {
      sessionRef.current = false
      setSessionActive(false)
      setAgentState('error')
      onErrorRef.current?.(err?.message || 'Cannot access microphone.')
      throw err
    }
  }, [startRecording, setAgentState])

  const stopSession = useCallback(() => {
    sessionRef.current = false
    activeTurnRef.current = false
    historyRef.current = []
    setSessionActive(false)
    stopVAD()
    stopRecorder()
    stopPlayback()
    streamRef.current?.getTracks()?.forEach((t) => t.stop())
    streamRef.current = null
    // Disconnect mic analyser source
    if (micSourceRef.current) {
      try { micSourceRef.current.disconnect() } catch { /* ok */ }
      micSourceRef.current = null
    }
    setAgentState('idle')
  }, [setAgentState, stopPlayback, stopRecorder, stopVAD])

  /* ── Text-only turn (optional) ────────────────────────── */

  const sendText = useCallback(async (text) => {
    if (!text?.trim()) return
    setAgentState('processing')
    sessionRef.current = true
    setSessionActive(true)
    try {
      const result = await sendRequest({ text: text.trim() })
      await processTurn(result)
    } catch (err) {
      onErrorRef.current?.(err?.message || 'Text turn failed.')
      setAgentState('error')
    }
  }, [processTurn, sendRequest, setAgentState])

  /* ── Cleanup on unmount ───────────────────────────────── */

  useEffect(() => {
    return () => {
      sessionRef.current = false
      activeTurnRef.current = false
      stopVAD()
      stopPlayback()
      stopRecorder()
      streamRef.current?.getTracks()?.forEach((t) => t.stop())
      if (micSourceRef.current) {
        try { micSourceRef.current.disconnect() } catch { /* ok */ }
      }
      if (audioCtxRef.current?.state !== 'closed') {
        audioCtxRef.current?.close().catch(() => { })
      }
    }
  }, [stopPlayback, stopRecorder, stopVAD])

  return { state, analyser, sessionActive, startSession, stopSession, stopRecording: stopRecorder, sendText, lastTurn }
}