# PROJECT_CONTEXT.md — VISHESH SOMPURA AI
> **Purpose**: This document is the single source of truth for any AI assistant working on this codebase. Read it fully before making any changes. It describes the architecture, data flows, design decisions, and every significant implementation detail across all layers.

---

## 1. Project Overview

**Name**: VISHESH SOMPURA AI ("speech/voice" in Sanskrit/Hindi)  
**Version**: 2.1.0  
**Type**: Hybrid real-time Indian-language voice assistant (Speech-to-Speech)  
**Author**: Vishesh Sompura  
**Assessment context**: DroneLab Assessment submission

### What it does
Users open the web UI, tap the mic button, and speak naturally in any Indian language (or Hinglish). The app:
1. Records audio in the browser
2. Sends it to a Node.js backend
3. Backend transcribes it (Sarvam STT), generates a reply (Sarvam LLM), then synthesizes speech (Indic Parler-TTS or Sarvam Bulbul TTS fallback)
4. Returns base64 audio + metadata to the browser
5. Browser plays back audio while the animated orb reacts in real-time

This is a **full-duplex turn-based** voice conversation loop — NOT streaming WebSocket-based. Each turn is a discrete HTTP POST.

---

## 2. Repository Layout

```
VaiH/
├── index.html                  # Vite root HTML — loads fonts, global CSS resets, mounts #root
├── style.css                   # Global CSS (partially legacy, commented old rules remain)
├── vite.config.js              # Vite dev config — proxies /api → localhost:8787
├── package.json                # Project metadata, scripts, JS dependencies
├── .env / .env.example         # Runtime config (API keys, model names, ports)
│
├── src/                        # React frontend (Vite + React 18)
│   ├── main.jsx                # React entry point — mounts <App /> in StrictMode
│   ├── App.jsx                 # Root component — UI layout, state display, mic button
│   ├── components/
│   │   ├── VoiceOrb.jsx        # Canvas-based animated orb, frequency-reactive
│   │   └── ApiKeySetup.jsx     # (dormant) UI for user-supplied API key — NOT used in main flow
│   └── hooks/
│       └── useHybridVoiceAgent.js  # Core voice agent logic — mic, network, playback, history
│
├── server/
│   └── index.js                # Express backend — STT → LLM → TTS pipeline, REST API
│
└── tts/
    ├── parler_service.py       # Python FastAPI sidecar — runs ai4bharat/indic-parler-tts model
    └── requirements.txt        # Python deps: fastapi, uvicorn, torch, transformers, parler-tts, soundfile
```

---

## 3. Technology Stack

### Frontend
| Layer | Technology |
|---|---|
| Framework | React 18 (Vite, JSX) |
| Styling | Inline JS style objects (no CSS modules, no Tailwind) |
| Fonts | Google Fonts: `Syne` (brand headers), `DM Sans` (body) |
| Animation | Canvas 2D API (`requestAnimationFrame` loop in `VoiceOrb.jsx`) |
| Audio capture | Web Browser APIs: `MediaRecorder`, `getUserMedia`, `Web Audio API` |
| Audio playback | Native `<Audio>` element via `new Audio(url)` |
| Build tool | Vite 5.x |

### Backend (Node.js)
| Layer | Technology |
|---|---|
| Runtime | Node.js (ES Modules — `"type": "module"` in package.json) |
| Server | Express 4 |
| File upload | Multer (memory storage, 25MB limit) |
| Env config | dotenv |
| HTTP client | Native `fetch` (no axios/SDK) |
| Audio temp storage | `node:fs/promises` + `os.tmpdir()` |

### AI Services
| Service | Provider | Model | Purpose |
|---|---|---|---|
| STT | Sarvam AI | `saarika:v2` | Indian-language speech-to-text |
| LLM | Sarvam AI | `sarvam-m` | Multilingual Indian language chat |
| TTS (primary) | AI4Bharat | `ai4bharat/indic-parler-tts` | High-quality neural Indian voice synthesis |
| TTS (fallback) | Sarvam AI | `bulbul:v1` | 11-language cloud TTS fallback |

### Python TTS Sidecar
| Layer | Technology |
|---|---|
| Framework | FastAPI + Uvicorn |
| Model | `ai4bharat/indic-parler-tts` via HuggingFace Transformers |
| Inference | PyTorch (CUDA if available, else CPU) |
| Audio encoding | SoundFile → WAV → Base64 |

---

## 4. End-to-End Data Flow

```
┌─────────────────────────────────────────────────────┐
│                     BROWSER                          │
│                                                      │
│  User taps mic → startSession() → startRecording()  │
│      │                                               │
│      ▼                                               │
│  navigator.mediaDevices.getUserMedia({ audio: true })│
│      │  MediaStream                                  │
│      ▼                                               │
│  MediaRecorder (audio/webm;codecs=opus preferred)   │
│      │  chunks collected in chunksRef                │
│      ▼                                               │
│  User taps stop → recorder.stop() → onstop fires    │
│      │  Blob (webm audio, ~100+ bytes)               │
│      ▼                                               │
│  FormData POST /api/turn                             │
│    Fields: audio (Blob), history (JSON), ttsProvider │
└──────────────────────────┬──────────────────────────┘
                           │
                    HTTP POST (multipart/form-data)
                           │
┌──────────────────────────▼──────────────────────────┐
│                  NODE.JS SERVER (:8787)               │
│                                                      │
│  multer.single('audio') → req.file.buffer            │
│      │                                               │
│  Step 1: transcribeAudio(buffer)                    │
│      │  → writeTempFile() to os.tmpdir()            │
│      │  → Blob + FormData to Sarvam STT API         │
│      │  → POST https://api.sarvam.ai/speech-to-text │
│      │     model: saarika:v2                         │
│      │     language_code: 'unknown' (auto-detect)   │
│      │  ← { transcript, language_code }             │
│      │  → cleanupTemp() removes temp files           │
│      │                                               │
│  Step 2: generateReply({ transcript, history, lang })│
│      │  → system prompt: "You are VISHESH SOMPURA AI…"│
│      │  → POST https://api.sarvam.ai/v1/chat/       │
│      │        completions                            │
│      │     model: sarvam-m                           │
│      │     messages: [system, ...history, user]      │
│      │     temperature: 0.75, top_p: 0.95            │
│      │     max_tokens: 240                           │
│      │  ← reply text                                 │
│      │                                               │
│  Step 3: synthesize({ text, languageCode })          │
│      │                                               │
│      ├─ Try Indic Parler-TTS (if PARLER_TTS_URL set) │
│      │    POST http://localhost:8000/synthesize       │
│      │    { text, languageCode, style }               │
│      │  ← { audioBase64, mimeType: 'audio/wav' }     │
│      │                                               │
│      └─ Fallback: Sarvam Bulbul TTS                  │
│           POST https://api.sarvam.ai/text-to-speech  │
│           { inputs, target_language_code, speaker,   │
│             model, enable_preprocessing: true }       │
│         ← { audios: [base64wav] }                    │
│                                                      │
│  → res.json({ transcript, reply, languageCode,       │
│               audioBase64, audioMimeType,             │
│               audioProvider })                        │
└──────────────────────────┬──────────────────────────┘
                           │
                    HTTP 200 JSON response
                           │
┌──────────────────────────▼──────────────────────────┐
│                     BROWSER                          │
│                                                      │
│  processTurn(data)                                   │
│      │  → push transcript + reply to historyRef      │
│      │    (rolling window, max 20 messages)          │
│      ▼                                               │
│  playReply(base64, mimeType)                        │
│      │  → base64ToBlob() → URL.createObjectURL()    │
│      │  → new Audio(url).play()                     │
│      │  → setAgentState('speaking')                 │
│      │  → pulseOn() → Web Audio gain ramp           │
│      ▼  (audio ends)                                │
│  pulseOff() → ramp gain back down                   │
│      ▼                                               │
│  autoListen=true → setAgentState('listening')        │
│                 → startRecording() (loop begins)     │
└─────────────────────────────────────────────────────┘
```

---

## 5. Agent State Machine

The UI and audio pipeline are driven by a single `state` string managed by `useHybridVoiceAgent`:

```
          ┌───────────────┐
          │     idle      │ ← initial state; session not started
          └──────┬────────┘
                 │ user taps mic (startSession)
                 ▼
          ┌───────────────┐
          │   listening   │ ← MediaRecorder running, mic open
          └──────┬────────┘
                 │ user taps stop (stopRecorder → onstop)
                 ▼
          ┌───────────────┐
          │  processing   │ ← HTTP request in flight
          └──────┬────────┘
                 │ response received, playReply called
                 ▼
          ┌───────────────┐
          │   speaking    │ ← audio playing back
          └──────┬────────┘
                 │ audio.ended / audio.error
   autoListen    ▼
    = true  ┌───────────────┐
    ──────► │   listening   │  (loop continues)
            └───────────────┘
                 │ stopSession() called
                 ▼
          ┌───────────────┐
          │     idle      │
          └───────────────┘
                 ▲
                 │ (any exception in processing/recording)
          ┌───────────────┐
          │     error     │ ← tap to retry shown
          └───────────────┘
```

**State-to-UI color mapping** (`App.jsx`):
- `idle` → orange gradient (`#FFBB55` → `#FF6A00`)
- `listening` → cyan/blue gradient (`#00DDFF` → `#0066FF`)
- `speaking` → orange/red gradient (`#FF9933` → `#FF3300`)
- `processing` → no mic color change (pill indicator shows "Thinking…")
- `error` → error text shown in red, mic shows orange (idle colors)

---

## 6. Frontend Architecture

### `src/main.jsx`
Trivial entry point. Just mounts `<App />` inside `React.StrictMode`.

---

### `src/App.jsx`
**The only top-level UI component.** No React Router — single page, no navigation.

**Key responsibilities:**
- Instantiates `useHybridVoiceAgent` hook with `backendUrl: '/api'` and `autoListen: true`
- Manages `error` state via `onError` / `onStateChange` callbacks
- Renders a fixed dark background (`#060608`) with a conditional radial glow
- Header: brand name "VISHESH · SOMPURA", sub-brand "Shuka S2S · Indic Parler-TTS", status pill
- Main: `<VoiceOrb>` (canvas), hint text / error text, mic/stop button, speaker wave bars
- Footer: attribution credits
- All styles are inline JS objects in the `S` constant at bottom of file — **no CSS classes used**

**State-driven visual changes:**
- Background glow: orange (idle/speaking) or blue (listening) radial gradient
- Status pill border/dot/label color changes
- Mic button gradient + box-shadow changes per state
- Speaker wave bars (`waveBar` keyframe animation) only visible in `speaking` state
- Orb (`VoiceOrb`) gets `state` + `analyser` props to self-render

**Inline SVG icons** (no icon library):
- `<MicIcon>` — mic SVG for idle state button
- `<StopIcon>` — filled square SVG for active session button
- `<SpeakerIcon color={accentColor}>` — speaker with sound arcs, shown during speaking

---

### `src/components/VoiceOrb.jsx`
**The centerpiece animated visualization.** All rendering happens on `<canvas>` via the Canvas 2D API.

**Key technical details:**
- **Hi-DPI**: canvas is `480 * devicePixelRatio` internally, CSS width/height is `100%` of parent.
- **Animation loop**: `requestAnimationFrame` driven via `loop()` → `drawFrame(t)` where `t` is a clock incrementing by `0.016` each frame.
- **Audio data**: analyser node's `getByteFrequencyData(Uint8Array)` is polled every frame. The array has `analyser.frequencyBinCount` bins divided into `bass` (bins 0–5), `mid` (bins 6–27), `high` (bins 28–63), and `avg`.
- **Blob shape**: 160 points computed around a circle (`θ` from 0 to 2π), each radius modified by sine waves whose frequencies and amplitudes depend on the current `state`.
- **Smoothing**: Blob outline is drawn with `quadraticCurveTo` between midpoints — produces smooth curved surface without hard angles.
- **Gradient fill**: `createRadialGradient` with 4 color stops from palette — center bright, outer dark. An additional specular highlight gradient simulates a glass/fluid surface.
- **Outer halos**: 1–3 concentric radial gradient circles behind the blob (more halos in `speaking` state).
- **Frequency bars**: Ring of 64 radial line bars drawn outside the blob — only in `speaking` state.
- **Ripple rings**: 3 expanding concentric stroked circles — only in `listening` state.
- **Connecting spinner**: Arc that rotates — only in `connecting` state (NOTE: `connecting` is defined here but never set by useHybridVoiceAgent — it's prepared for future use).

**State palette lookup** (`STATE_PALETTES`):
- `idle` / `connecting`: orange/amber tones
- `listening`: cyan/blue tones
- `speaking`: yellow-orange-red tones

**Performance**: The `useEffect` depends on `[state, analyser]`. Each state change **restarts the canvas drawing loop** entirely (previous `requestAnimationFrame` is cancelled in cleanup).

---

### `src/components/ApiKeySetup.jsx`
*(Dormant — not imported anywhere in the current codebase)*
- A UI form component that would allow users to input a Sarvam API key from the browser
- Saves to `localStorage` under `vani_api_key`
- Not integrated into the current flow — backend uses `SARVAM_API_KEY` from `.env`

---

### `src/hooks/useHybridVoiceAgent.js`
**The core orchestration hook** — handles all audio I/O, state management, backend communication, and conversation history.

#### Exported API
```js
const {
  state,          // string: 'idle' | 'listening' | 'processing' | 'speaking' | 'error'
  analyser,       // AnalyserNode | null — passed to VoiceOrb for visualization
  sessionActive,  // boolean — true when session is ongoing
  startSession,   // async () => void — request mic, begin recording
  stopSession,    // () => void — stop everything, reset to idle
  sendText,       // async (text: string) => void — text-only turn (no mic needed)
  lastTurn,       // { transcript, reply, languageCode, audioProvider } | null
} = useHybridVoiceAgent({ backendUrl, autoListen, onError, onStateChange, onTurnComplete })
```

#### Key Refs (don't trigger re-renders, survive renders)
| Ref | Type | Purpose |
|---|---|---|
| `streamRef` | MediaStream | Mic stream — reused across recordings within session |
| `recorderRef` | MediaRecorder | Current or last recorder instance |
| `chunksRef` | Blob[] | Audio data chunks collected while recording |
| `sessionRef` | boolean | Source of truth for session-active (avoids stale closure) |
| `activeTurnRef` | boolean | Guards against concurrent turn processing |
| `audioCtxRef` | AudioContext | Shared Web Audio context |
| `analyserRef` | AnalyserNode | Frequency analyser node |
| `gainRef` | GainNode | Silent oscillator gain — modulated to pulse VoiceOrb |
| `playbackRef` | HTMLAudioElement | Currently playing audio element |
| `historyRef` | Message[] | Rolling conversation history (max 20 msgs) |
| `stateRef` | string | Mirror of `state` — avoids stale closure in callbacks |
| `startRecRef` | Function | Forward ref to break circular dep in processTurn |
| `backendRef` | string | Mirror of backendUrl prop |
| `autoListenRef` | boolean | Mirror of autoListen prop |
| `onErrorRef` | Function | Mirror of onError callback |
| `onStateRef` | Function | Mirror of onStateChange callback |
| `onTurnRef` | Function | Mirror of onTurnComplete callback |

#### Web Audio Graph
```
OscillatorNode (sine, 4Hz) ──► GainNode (normally ≈0) ──► AnalyserNode ──► AudioContext.destination
                                    ↑
                        pulseOn() / pulseOff() ← modulated to animate orb during recording/playback
```

The "silent oscillator trick" keeps the `AnalyserNode` active even when nothing is playing so `VoiceOrb` can animate idly. `pulseOn()` ramps gain to 0.85 (triggers orb animation), `pulseOff()` ramps it back to 0.0001.

#### Audio MIME Type Negotiation
`pickMimeType()` tries types in this preference order:
1. `audio/webm;codecs=opus` (Chrome/Edge — best quality)
2. `audio/webm` (Firefox)
3. `audio/mp4` (Safari)

Backend reads the `originalname` extension from multer to set the correct MIME when creating the temp file + Blob for STT.

#### TTS Provider Selection
The hook reads `localStorage.getItem('vani_tts_provider')` at send time and passes it in the form as `ttsProvider`. The backend uses this to decide whether to try Parler first. Default: `'parler'`.

#### Conversation History Management
- `historyRef.current` is an array of `{ role: 'user'|'assistant', content: string }` messages
- The last 14 messages are sent to the server in each request (as JSON string in form field `history`)
- The server's `parseHistory()` further slices to last 16 and validates structure
- History is cleared on `stopSession()` and on `startSession()`
- Max local window: 20 messages (truncated after every `processTurn`)

---

## 7. Backend Architecture

### `server/index.js`

**Single-file Express server**, ES Module format. No TypeScript.

#### Environment Variables
| Variable | Default | Description |
|---|---|---|
| `PORT` | `8787` | Server listen port |
| `SARVAM_API_KEY` | (required) | Sarvam AI subscription key — sent as `api-subscription-key` header |
| `SARVAM_STT_MODEL` | `saarika:v2` | STT model name |
| `SARVAM_TTS_MODEL` | `bulbul:v1` | Sarvam TTS fallback model |
| `SARVAM_LLM_MODEL` | `sarvam-m` | Chat completion model |
| `PARLER_TTS_URL` | `''` | Base URL of Parler sidecar (e.g. `http://localhost:8000`) |

**Note**: `.env.example` references `saaras:v3` and `bulbul:v3` — these are future/upgraded model names. The code defaults to the currently-validated `saarika:v2` / `bulbul:v1`.

#### API Routes

**`GET /api/health`**
```json
{
  "ok": true,
  "sttModel": "saarika:v2",
  "llmModel": "sarvam-m",
  "ttsModel": "bulbul:v1",
  "parlerConfigured": false,
  "sarvamConfigured": true
}
```

**`POST /api/turn`** (multipart/form-data)

Request fields:
| Field | Type | Description |
|---|---|---|
| `audio` | File (webm/mp4) | Recorded audio blob (optional if `text` provided) |
| `text` | string | Text input bypass (alternative to audio) |
| `history` | JSON string | Array of prior `{role, content}` messages |
| `ttsProvider` | string | `'parler'` or `'sarvam'` |
| `languageCode` | string | Hint for language if using text-only path |

Response body:
```json
{
  "transcript": "namsate aap kaisa hai",
  "reply": "नमस्ते! मैं बिल्कुल ठीक हूँ, शुक्रिया। आप कैसे हैं?",
  "languageCode": "hi-IN",
  "audioBase64": "<base64-encoded WAV>",
  "audioMimeType": "audio/wav",
  "audioProvider": "parler-indic"   // or "sarvam-bulbul"
}
```

#### Helper Functions
- `sarvamHeaders(extra)` — merges `api-subscription-key` with any extra headers
- `cleanText(s)` — collapses whitespace + trims
- `parseHistory(raw)` — safe JSON parse of history; validates roles; caps at 16 messages
- `writeTempFile(buffer, ext)` — writes to `os.tmpdir()/vani-<uuid>/` with UUID filename; returns `{file, dir}`
- `cleanupTemp({file, dir})` — deletes temp file AND temp directory; ignores errors
- `fallbackReply(lang)` — returns a hardcoded safe Hindi or English fallback string when LLM fails

#### STT Implementation (`transcribeAudio`)
- Writes audio buffer to a temp file
- Re-reads as `Blob` with correct MIME type
- POSTs multipart form to `https://api.sarvam.ai/speech-to-text`
- Fields: `file`, `model`, `language_code: 'unknown'` (forces auto-detection), `with_timestamps: 'false'`
- Reads `transcript` (or `text`) and `language_code` from response
- Cleans up temp file in `finally`

#### LLM Implementation (`generateReply`)
- **System prompt**: Instructs the model to be "VISHESH SOMPURA AI" — a warm Indian voice assistant, reply in the SAME language/script/code-mixing style as user, keep answers SHORT (natural for speech), avoid markdown/bullet points
- Full conversation history included in `messages` array (system + history + current user)
- Calls `/v1/chat/completions` endpoint (OpenAI-compatible format on Sarvam)
- `max_tokens: 240` — kept intentionally short for voice suitability
- `temperature: 0.75`, `top_p: 0.95`

#### TTS Implementation

**Primary — Parler (`parlerTTS`)**:
- POST to `${PARLER_TTS_URL}/synthesize` with `{text, languageCode, style}`
- `style` is always hardcoded as `'warm friendly conversational Indian voice'`
- Returns `{base64, mimeType: 'audio/wav', provider: 'parler-indic'}`

**Fallback — Sarvam Bulbul (`sarvamTTS`)**:
- `normLang()` normalizes shortcodes (e.g. `'hi'` → `'hi-IN'`)
- `SPEAKER_MAP` maps language prefixes to speaker names (e.g. `'hi'` → `'meera'`)
- POST to `/text-to-speech` with `{inputs, target_language_code, speaker, model, enable_preprocessing: true}`
- `enable_preprocessing: true` — lets Sarvam handle number normalization, script handling

**Unified (`synthesize`)**:
- Tries Parler first if `PARLER_TTS_URL` is set and `preferParler` is true
- On any Parler error → falls back to Sarvam Bulbul silently (warns to console)

---

## 8. Python TTS Sidecar (`tts/parler_service.py`)

### Purpose
Runs the `ai4bharat/indic-parler-tts` model locally as an HTTP microservice. This model has 69 voices with fine-grained emotion/style control via a text description ("caption").

### Startup
```bash
cd tts
pip install -r requirements.txt
uvicorn parler_service:app --host 0.0.0.0 --port 8000
```

### Model Loading
- Model ID: `ai4bharat/indic-parler-tts` (configurable via `PARLER_MODEL_ID` env var)
- Device: `cuda:0` if PyTorch CUDA available, else `cpu`
- Two tokenizers are needed:
  1. **prompt_tokenizer**: tokenizes the text TO BE SPOKEN
  2. **description_tokenizer**: tokenizes the voice-style caption. The tokenizer ID is read from `model.config.text_encoder._name_or_path` (falls back to same repo if attribute missing)
- Model is loaded once on startup (`@app.on_event("startup")`) and cached in `_bundle` global — subsequent requests are fast.
- Graceful import: if `torch`/`transformers`/`parler-tts`/`soundfile` are not installed, the module loads but raises `RuntimeError` on first `/synthesize` call.

### Voice Caption System
Each language has a predefined voice description string (`LANGUAGE_VOICES`). These descriptions control speaker identity, pace, and affect in Parler-TTS models:

| Language | Speaker Description |
|---|---|
| Hindi (hi) | "Rohit speaks with a warm, clear Hindi accent, gentle pace, expressive intonation." |
| Tamil (ta) | "Divya speaks Tamil with a melodic, clear, and pleasant delivery." |
| Telugu (te) | "Arjun speaks Telugu with an expressive, warm, and confident tone." |
| Bengali (bn) | "Priya speaks Bengali with a musical lilt, moderate pace, clear articulation." |
| ... | (11 languages + Indian English defined) |

The final caption is built as:
```
"{voice_description} Studio-quality {language} audio, {style}. Clear pronunciation, pleasant conversational pace, natural delivery."
```

### Inference Pipeline
```python
desc_inputs   = description_tokenizer(caption)   # tokenize style
prompt_inputs = prompt_tokenizer(text)            # tokenize speech text
generation    = model.generate(
    input_ids=desc_inputs.input_ids,
    attention_mask=desc_inputs.attention_mask,
    prompt_input_ids=prompt_inputs.input_ids,
    prompt_attention_mask=prompt_inputs.attention_mask,
)
audio_numpy   = generation.cpu().numpy().squeeze()
wav_bytes     = soundfile.write(buffer, audio_numpy, samplerate=model.config.sampling_rate)
base64_str    = base64.b64encode(wav_bytes).decode()
```

### Endpoints
- `GET /health` → `{ok, model, device, loaded}` — loaded is true once `_bundle` is set
- `POST /synthesize` → `{audioBase64, mimeType: "audio/wav"}`
  - Input: `{text (str, 1–2500 chars), languageCode (str, default "hi-IN"), style (str)}`
  - Raises HTTP 500 on inference failure

---

## 9. Configuration & Environment

### `.env` file (at project root)
```env
PORT=8787
SARVAM_API_KEY=<your-sarvam-key>        # Required
SARVAM_STT_MODEL=saarika:v2             # Optional, overrides default
SARVAM_TTS_MODEL=bulbul:v1             # Optional, overrides default
SARVAM_LLM_MODEL=sarvam-m              # Optional, overrides default
PARLER_TTS_URL=http://127.0.0.1:8000   # Optional — enables Parler TTS
```

### Vite Proxy (`vite.config.js`)
The Vite dev server runs on `:5173` and proxies all `/api/*` requests to `http://localhost:8787`.  
In production, the Node server would serve the built React assets directly.

### Dev Commands
```bash
npm run dev         # starts both Vite (:5173) + Node (:8787) concurrently via concurrently package
npm run dev:client  # only Vite frontend
npm run dev:server  # only Node backend
npm run build       # Vite production build
npm run start       # Production: node server only (assumes dist/ already exists)
```

---

## 10. Frontend UI Design System

All styles are **inline JS objects** in `App.jsx`. There is no dedicated CSS variables system or theming file.

### Color Palette
| Token | Value | Usage |
|---|---|---|
| Background | `#060608` | Full-page background |
| Text | `#F5F0E8` | Warm off-white for all text |
| Orange accent (idle) | `#FF6A00` | Button gradient, pill border |
| Blue accent (listening) | `#00CCFF` | Mic button, glow, pill |
| Orange accent (speaking) | `#FF9933` | Speaker icon, wave bars |
| Error text | `#FF9090` | Error message text |
| Error bg | `rgba(255,80,80,0.08)` | Error box background |

### Typography
- **Brand name**: `Syne` 800 weight, 20px
- **Sub-brand**: 11px, 0.30 opacity, tracking 0.5
- **Body / hint**: `DM Sans`, 13px
- **Mic label**: 11.5px uppercase, tracking 0.5

### Animations
| Name | Target | Behavior |
|---|---|---|
| `waveBar` | 5 bar divs in speaker row | sine height animation, 0.9s, staggered `animation-delay` 0.12s per bar |
| `micPulse` | Mic button (defined but not applied in current code) | Alternating box-shadow glow |
| Canvas orb | `<canvas>` in VoiceOrb | rAF loop at ~60fps |

---

## 11. Known Issues, Gaps, and TODOs

### Current Limitations
1. **No streaming audio**: The entire AI pipeline (STT + LLM + TTS) runs before audio is returned. Latency can be 2–5+ seconds depending on model, network, and whether Parler runs on CPU.
2. **No VAD (Voice Activity Detection)**: The user must manually tap stop to end recording. There is no silence detection or automatic cutoff.
3. **No visual transcript display**: The `transcript` and `reply` returned from the server are not shown anywhere in the UI (only stored in history).
4. **`ApiKeySetup.jsx` is unused**: It was built but never integrated into the main app flow.
5. **`connecting` state is unused**: VoiceOrb has a full `connecting` animation but `useHybridVoiceAgent` never sets this state.
6. **`style.css` has commented-out legacy code**: The file has an old CSS-class based design commented out. Only the bottom ≈12 lines are active.
7. **TTS provider not configurable from UI**: The `localStorage.getItem('vani_tts_provider')` mechanism exists but there's no UI toggle — defaults to `'parler'`.
8. **No error recovery for STT silence**: If the user records but says nothing, the server returns `400: No audio or text provided` but the client just shows the generic error string.
9. **Parler model cold start**: First request to Parler sidecar may timeout if model hasn't loaded yet (startup loading is async and may fail silently).

### Design Decisions Worth Knowing
- **All-in-one Express server**: The Node backend is a single file with no routing layer — all logic is inline, intentionally simple.
- **Refs over state for audio graph**: Audio context, analyser, recorder, etc. are all `useRef` to avoid triggering re-renders on every audio event.
- **No SDK for Sarvam**: All Sarvam API calls use raw `fetch` per comment in server — avoids SDK version pinning issues.
- **FormData for turns**: Audio and metadata are sent as `multipart/form-data` (not JSON + separate upload) for simplicity.
- **Rolling history window**: Only the last 14 messages are sent to the server to stay within LLM context limits.

---

## 12. External API Reference

### Sarvam AI
- **Base URL**: `https://api.sarvam.ai`
- **Auth**: Header `api-subscription-key: <key>` (NOT Bearer token)
- **STT endpoint**: `POST /speech-to-text` — multipart form with `file`, `model`, `language_code`, `with_timestamps`
- **LLM endpoint**: `POST /v1/chat/completions` — OpenAI-compatible JSON body
- **TTS endpoint**: `POST /text-to-speech` — JSON body with `inputs` (array), `target_language_code`, `speaker`, `model`, `enable_preprocessing`

### AI4Bharat Indic Parler-TTS
- **HuggingFace repo**: `ai4bharat/indic-parler-tts`
- **Architecture**: Parler-TTS (description-conditioned TTS)
- **Voice count**: 69 unique voices across Indian languages
- **Control mechanism**: Text captions describe speaker identity, language, pace, and emotion

---

## 13. Supported Languages

Auto-detection is used for STT (no language needs to be specified by the user). The system supports all of:

| Language | Code | STT | LLM | Parler Voices | Sarvam Bulbul Speaker |
|---|---|---|---|---|---|
| Hindi | hi-IN | ✅ | ✅ | Rohit | meera |
| Tamil | ta-IN | ✅ | ✅ | Divya | ananya |
| Telugu | te-IN | ✅ | ✅ | Arjun | arya |
| Bengali | bn-IN | ✅ | ✅ | Priya | maitri |
| Gujarati | gu-IN | ✅ | ✅ | Nisha | diya |
| Marathi | mr-IN | ✅ | ✅ | Suresh | pooja |
| Kannada | kn-IN | ✅ | ✅ | Kiran | vidya |
| Malayalam | ml-IN | ✅ | ✅ | Lakshmi | nila |
| Punjabi | pa-IN | ✅ | ✅ | Gurpreet | punjabi |
| Odia | od-IN | ✅ | ✅ | Ananya | odia |
| Urdu | ur-IN | ✅ | ✅ | Sara | urdu |
| Indian English | en-IN | ✅ | ✅ | Priya (IE) | (default) |
| Hinglish | hi/en mix | ✅ | ✅ | (Hindi voice) | meera |

---

## 14. File-by-File Quick Reference

| File | Lines | Purpose | Key Exports |
|---|---|---|---|
| `index.html` | 30 | Vite HTML shell, font loads | — |
| `style.css` | 55 | Global resets + (commented legacy) | — |
| `vite.config.js` | 13 | Vite config, /api proxy | — |
| `package.json` | 30 | scripts, deps | — |
| `.env.example` | 9 | Environment variable template | — |
| `src/main.jsx` | 9 | React root mount | — |
| `src/App.jsx` | 304 | Root UI component | `default App` |
| `src/components/VoiceOrb.jsx` | 231 | Canvas orb animation | `default VoiceOrb` |
| `src/components/ApiKeySetup.jsx` | ~100 | (Unused) API key UI | `default ApiKeySetup` |
| `src/hooks/useHybridVoiceAgent.js` | 367 | Voice agent orchestration | `useHybridVoiceAgent` |
| `server/index.js` | 318 | Express backend, full AI pipeline | — |
| `tts/parler_service.py` | 185 | Python FastAPI TTS sidecar | FastAPI `app` |
| `tts/requirements.txt` | 6 | Python package deps | — |

---

## 15. Recommended Next Development Steps

Based on the current codebase, the highest-impact improvements for a future developer to consider:

1. **Add VAD (silence detection)**: Use WebRTC VAD or audio level threshold to auto-stop recording after N seconds of silence — removes the need to manually tap stop, making it feel truly hands-free.
2. **Streaming TTS**: Instead of returning full base64 audio, stream audio chunks progressively to reduce perceived latency. Sarvam may support chunked streaming.
3. **Show transcript + reply text**: Surface `lastTurn.transcript` and `lastTurn.reply` in the UI (even a subtle scrolling text under the orb) for accessibility and debugging.
4. **Integrate `ApiKeySetup.jsx`**: Allow users to bring their own Sarvam API key and store it in `localStorage`, forwarded via a request header — enables a deployable public demo.
5. **Add a TTS provider toggle**: Simple switch in the UI that sets `localStorage.vani_tts_provider` to `'parler'` or `'sarvam'`, exposed in the settings panel.
6. **Implement `connecting` state**: Set state to `'connecting'` during the initial API key check / session setup moment so the VoiceOrb connecting animation is actually used.
7. **Add a conversation history panel**: Collapsible sidebar or bottom sheet showing the full conversation transcript — already stored in `historyRef`, just needs to be surfaced.
8. **Error classification**: Different error messages for mic permission denied, network failure, STT failure, and LLM failure instead of the generic error string.
9. **Production deployment**: Wire `server/index.js` to serve the `dist/` folder (Vite build output) as static assets — currently the Node server has no static file serving for production.
10. **Parler health check on startup**: Ping `PARLER_TTS_URL/health` on server startup to confirm sidecar is ready; expose this in the `/api/health` response.
