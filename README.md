# VISHESH SOMPURA AI — Speech-to-Speech Voice Agent

Hybrid Indian-language voice assistant powered by **Sarvam AI** APIs - real-time speech understanding (STT), intelligent conversation (LLM), and natural voice synthesis (TTS) for 13+ Indian languages.

## ✨ Features

- 🎙️ **Voice Activity Detection (VAD)** — auto-detects when you stop speaking, no buttons needed
- 🔄 **Hands-free conversation loop** — tap once to start, the agent listens → thinks → speaks → listens again
- 🌐 **13+ Indian languages** — Hindi, English, Tamil, Telugu, Bengali, Gujarati, Marathi, Punjabi, Kannada, Malayalam, Odia, Urdu + Hinglish
- 🧠 **Sarvam-M LLM** — responds in the same language and script the user speaks
- 🔊 **Bulbul v3 TTS** — natural Indian voices with 40+ speaker options
- 🎨 **VoiceOrb visualization** — animated orb that reacts to audio in real-time

## 📋 Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- A **Sarvam AI API key** — get one at [dashboard.sarvam.ai](https://dashboard.sarvam.ai/)

## 🚀 Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and add your Sarvam API key:

```env
PORT=8787
SARVAM_API_KEY=your_sarvam_api_key_here
SARVAM_LLM_MODEL=sarvam-m
SARVAM_STT_MODEL=saaras:v3
SARVAM_TTS_MODEL=bulbul:v3
DEFAULT_TTS_PROVIDER=sarvam
PARLER_TTS_URL=
ALLOW_CORS=true
```

### 3. Run (both servers together)

```bash
npm run dev
```

Or run them separately in two terminals:

```bash
# Terminal 1 — Backend (port 8787)
npm run dev:server

# Terminal 2 — Frontend (port 5173)
npm run dev:client
```

### 4. Open the app

Go to **http://localhost:5173** — tap the mic and speak in any Indian language.

## 🗣️ How It Works

```
Browser mic
    │  WebM audio (auto-stops on silence via VAD)
    ▼
Node.js server (/api/turn)
    │
    ├─ Sarvam STT (saaras:v3)         ← transcribes speech, auto-detects language
    │       transcript + language_code
    │
    ├─ Sarvam LLM (sarvam-m)          ← responds in same language/script
    │       reply text (think tags stripped)
    │
    └─ Sarvam TTS (bulbul:v3)         ← 40+ natural Indian voices
    │       base64 WAV audio
    ▼
Browser speaker + animated VoiceOrb
    │
    └─ Auto-listens again (hands-free loop)
```

## 🎛️ Optional: Indic Parler-TTS (local high-quality voices)

If you want to run the Parler-TTS sidecar locally for higher quality voices (supports CUDA and **Apple Silicon MPS**):

```bash
cd tts
pip install -r requirements.txt
uvicorn parler_service:app --host 0.0.0.0 --port 8000
```

Then update `.env`:

```env
PARLER_TTS_URL=http://localhost:8000
DEFAULT_TTS_PROVIDER=parler
```

> **Note**: Parler-TTS requires PyTorch with working `torchaudio`. On Apple Silicon Macs, the service automatically uses MPS acceleration. If you encounter ABI mismatch errors, try reinstalling PyTorch: `pip install --force-reinstall torch torchaudio`

The backend auto-falls-back to Sarvam Bulbul TTS if Parler is not available.

## 📁 Project Structure

```
├── server/
│   └── index.js            # Express backend — STT → LLM → TTS pipeline
├── src/
│   ├── App.jsx              # Main React app with mic button
│   ├── hooks/
│   │   └── useHybridVoiceAgent.js  # Voice agent hook with VAD
│   └── components/
│       └── VoiceOrb.jsx     # Animated audio-reactive orb
├── tts/
│   ├── parler_service.py    # Optional Parler-TTS FastAPI sidecar
│   └── requirements.txt     # Python dependencies
├── .env.example             # Environment template
├── vite.config.js           # Vite config with API proxy
└── package.json
```

## 🔧 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | Backend server port |
| `SARVAM_API_KEY` | — | **Required.** Your Sarvam AI API key |
| `SARVAM_LLM_MODEL` | `sarvam-m` | LLM model for conversation |
| `SARVAM_STT_MODEL` | `saaras:v3` | Speech-to-text model |
| `SARVAM_TTS_MODEL` | `bulbul:v3` | Text-to-speech model |
| `DEFAULT_TTS_PROVIDER` | `sarvam` | `sarvam` or `parler` |
| `PARLER_TTS_URL` | — | Parler sidecar URL (e.g. `http://localhost:8000`) |
| `ALLOW_CORS` | `true` | Enable CORS for development |

## 🌍 Supported Languages

Hindi · English · Hinglish · Tamil · Telugu · Bengali · Gujarati · Marathi · Punjabi · Kannada · Malayalam · Odia · Urdu + regional dialects (auto-detected)

## 👤 Author

**Vishesh Sompura**

## 📄 License

Private