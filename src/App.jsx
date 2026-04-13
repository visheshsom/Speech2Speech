import { useState, useCallback } from 'react'
import VoiceOrb from './components/VoiceOrb.jsx'
import { useHybridVoiceAgent } from './hooks/useHybridVoiceAgent.js'

const STATE_CFG = {
  idle:       { label: 'Tap to speak',    hint: 'हिंदी · English · தமிழ் · ગુજ. · বাংলা · తెలుగు · ਪੰਜਾਬੀ' },
  listening:  { label: 'Listening…',      hint: 'Speak naturally — auto-detects when you stop' },
  processing: { label: 'Thinking…',      hint: '' },
  speaking:   { label: 'Speaking…',      hint: 'Tap to end conversation' },
  error:      { label: 'Tap to retry',   hint: '' },
}

export default function App() {
  const [error, setError] = useState('')

  const { state, analyser, sessionActive, startSession, stopSession, stopRecording } = useHybridVoiceAgent({
    backendUrl: '/api',
    autoListen: true,
    onError:       (e) => e && setError(String(e)),
    onStateChange: (s) => { if (s !== 'error') setError('') },
  })

  const handleMic = useCallback(async () => {
    if (!sessionActive) {
      setError('')
      try { 
        await startSession() 
      } catch { /* onError handles it */ }
    } else {
      // Stop the entire session — VAD handles auto-stop during recording
      stopSession()
    }
  }, [sessionActive, startSession, stopSession])

  const cfg = STATE_CFG[state] ?? STATE_CFG.idle
  const isListening  = state === 'listening'
  const isSpeaking   = state === 'speaking'
  const isProcessing = state === 'processing'

  const accentColor = isSpeaking  ? '#FF9933'
                    : isListening ? '#00CCFF'
                    : '#FF6A00'

  return (
    <>
      {/* ── Background ─────────────────────────────────── */}
      <div style={S.bg} />
      <div style={{
        ...S.bgGlow,
        background: isSpeaking
          ? 'radial-gradient(circle, rgba(255,120,20,0.10) 0%, transparent 68%)'
          : isListening
          ? 'radial-gradient(circle, rgba(0,180,255,0.08) 0%, transparent 68%)'
          : 'radial-gradient(circle, rgba(255,80,10,0.06) 0%, transparent 68%)',
      }} />

      <div style={S.root}>

        {/* ── Header ─────────────────────────────────────── */}
        <header style={S.header}>
          <div>
            <div style={S.brand}>
              VISHESH<span style={S.brandDot}> · </span>
              <span style={S.brandEn}>SOMPURA</span>
            </div>
            <div style={S.subBrand}>Shuka S2S · Indic Parler-TTS</div>
          </div>

          <div style={{ ...S.pill, borderColor: `${accentColor}44` }}>
            <span style={{ ...S.pillDot, background: (isListening || isSpeaking || isProcessing) ? accentColor : '#333' }} />
            <span style={{ ...S.pillLabel, color: (isListening || isSpeaking) ? accentColor : 'rgba(245,240,232,0.55)' }}>
              {cfg.label}
            </span>
          </div>
        </header>

        {/* ── Orb ────────────────────────────────────────── */}
        <main style={S.main}>
          <div style={S.orbWrap}>
            <VoiceOrb state={state} analyser={analyser} />
          </div>

          {/* Hint text */}
          {cfg.hint && !error && (
            <p style={S.hint}>{cfg.hint}</p>
          )}
          {error && (
            <p style={S.errText}>{error}</p>
          )}

          {/* ── Mic button ─────────────────────────────────── */}
          <button
            onClick={handleMic}
            aria-label={sessionActive ? 'Stop' : 'Start speaking'}
            style={{
              ...S.mic,
              background: isListening
                ? 'linear-gradient(135deg, #00DDFF, #0066FF)'
                : isSpeaking
                ? 'linear-gradient(135deg, #FF9933, #FF3300)'
                : 'linear-gradient(135deg, #FFBB55, #FF6A00)',
              boxShadow: isListening
                ? '0 10px 36px rgba(0,200,255,0.30), 0 0 0 3px rgba(0,180,255,0.15)'
                : isSpeaking
                ? '0 10px 36px rgba(255,100,0,0.40), 0 0 0 3px rgba(255,120,0,0.18)'
                : '0 10px 36px rgba(255,130,40,0.22)',
              transform: isListening ? 'scale(1.06)' : 'scale(1)',
            }}
          >
            {sessionActive ? <StopIcon /> : <MicIcon />}
          </button>
          <div style={S.micLabel}>{sessionActive ? 'tap to stop' : 'tap to speak'}</div>

          {/* ── Speaker wave (speaking only) ─────────────── */}
          {isSpeaking && (
            <div style={S.speakerRow}>
              <SpeakerIcon color={accentColor} />
              <div style={S.waveGroup}>
                {[0,1,2,3,4].map(i => (
                  <div key={i} style={{ ...S.waveBar, animationDelay: `${i * 0.12}s` }} />
                ))}
              </div>
            </div>
          )}
        </main>

        {/* ── Footer ─────────────────────────────────────── */}
        <footer style={S.footer}>
          Powered by Sarvam AI · AI4Bharat · Meta Llama
        </footer>
      </div>

      {/* Speaking wave keyframes */}
      <style>{`
        @keyframes waveBar {
          0%,100% { height: 6px;  opacity: 0.5; }
          50%      { height: 22px; opacity: 1;   }
        }
        @keyframes micPulse {
          0%,100% { box-shadow: 0 10px 36px rgba(0,200,255,0.30), 0 0 0 3px rgba(0,180,255,0.15); }
          50%      { box-shadow: 0 10px 36px rgba(0,200,255,0.50), 0 0 0 7px rgba(0,180,255,0.08); }
        }
      `}</style>
    </>
  )
}

/* ── Icons ──────────────────────────────────────────────── */

function MicIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8"  y1="22" x2="16" y2="22" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <rect x="5" y="5" width="14" height="14" rx="2.5" />
    </svg>
  )
}

function SpeakerIcon({ color = '#FF9933' }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  )
}

/* ── Styles ─────────────────────────────────────────────── */

const S = {
  bg: {
    position: 'fixed', inset: 0,
    background: '#060608',
    zIndex: -2,
  },
  bgGlow: {
    position: 'fixed',
    top: '20%', left: '50%',
    transform: 'translateX(-50%)',
    width: 700, height: 700,
    borderRadius: '50%',
    pointerEvents: 'none',
    zIndex: -1,
    transition: 'background 1.2s ease',
  },
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    maxWidth: 520,
    margin: '0 auto',
    padding: '0 20px',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '18px 0 10px',
    flexShrink: 0,
  },
  brand: {
    fontFamily: "'Syne', sans-serif",
    fontWeight: 800, fontSize: 20,
    color: '#F5F0E8',
    letterSpacing: -0.4,
  },
  brandDot: { color: 'rgba(245,240,232,0.25)' },
  brandEn: { fontWeight: 400, fontSize: 17, color: 'rgba(245,240,232,0.55)' },
  subBrand: {
    marginTop: 3, fontSize: 11,
    color: 'rgba(245,240,232,0.30)',
    letterSpacing: 0.5,
  },
  pill: {
    display: 'flex', alignItems: 'center', gap: 7,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 20, padding: '5px 13px',
    transition: 'border-color 0.5s',
  },
  pillDot: {
    width: 7, height: 7, borderRadius: '50%',
    transition: 'background 0.4s',
    flexShrink: 0,
  },
  pillLabel: {
    fontSize: 12, fontWeight: 500, letterSpacing: 0.2,
    transition: 'color 0.4s',
  },
  main: {
    flex: 1,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    gap: 0, paddingBottom: 24,
  },
  orbWrap: {
    width: 'min(340px, 75vw)',
    height: 'min(340px, 75vw)',
    marginBottom: 12,
  },
  hint: {
    fontSize: 13, color: 'rgba(245,240,232,0.40)',
    textAlign: 'center', letterSpacing: 0.2,
    marginBottom: 28, lineHeight: 1.4,
    maxWidth: 340,
  },
  errText: {
    fontSize: 13, color: '#FF9090',
    textAlign: 'center',
    marginBottom: 24, lineHeight: 1.4,
    maxWidth: 320,
    background: 'rgba(255,80,80,0.08)',
    border: '1px solid rgba(255,80,80,0.15)',
    borderRadius: 12, padding: '10px 14px',
  },
  mic: {
    width: 88, height: 88,
    borderRadius: '50%',
    border: 'none',
    color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer',
    transition: 'transform 0.25s, box-shadow 0.35s, background 0.4s',
    flexShrink: 0,
  },
  micLabel: {
    marginTop: 12,
    fontSize: 11.5,
    color: 'rgba(245,240,232,0.25)',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  speakerRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    marginTop: 24,
  },
  waveGroup: {
    display: 'flex', alignItems: 'center', gap: 3,
  },
  waveBar: {
    width: 3, height: 6,
    background: 'linear-gradient(to top, #FF9933, #FFCC66)',
    borderRadius: 3,
    animation: 'waveBar 0.9s ease-in-out infinite',
  },
  footer: {
    textAlign: 'center',
    fontSize: 11,
    color: 'rgba(245,240,232,0.16)',
    padding: '8px 0 16px',
    letterSpacing: 0.3,
    flexShrink: 0,
  },
}