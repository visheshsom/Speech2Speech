"""
Indic Parler-TTS sidecar service (ai4bharat/indic-parler-tts)
──────────────────────────────────────────────────────────────
Start:  uvicorn parler_service:app --host 0.0.0.0 --port 8000
Health: GET  /health
Synth:  POST /synthesize  {text, languageCode, style}

Set PARLER_TTS_URL=http://localhost:8000 in the Node .env to enable it.
"""

import base64
import io
import os
from dataclasses import dataclass
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# ── optional heavy deps (graceful if missing) ──────────────
try:
    import torch
    from transformers import AutoTokenizer
    from parler_tts import ParlerTTSForConditionalGeneration
    import soundfile as sf
    IMPORT_ERROR: Optional[Exception] = None
except Exception as exc:
    torch = None  # type: ignore
    AutoTokenizer = None  # type: ignore
    ParlerTTSForConditionalGeneration = None  # type: ignore
    sf = None  # type: ignore
    IMPORT_ERROR = exc

MODEL_ID = os.getenv("PARLER_MODEL_ID", "ai4bharat/indic-parler-tts")
DEVICE = (
    "cuda:0" if (torch and torch.cuda.is_available())
    else "mps" if (torch and hasattr(torch.backends, "mps") and torch.backends.mps.is_available())
    else "cpu"
)

app = FastAPI(title="Indic Parler-TTS Service", version="1.1.0")


# ── Model bundle ───────────────────────────────────────────

@dataclass
class ModelBundle:
    model:                Any   # ParlerTTSForConditionalGeneration
    prompt_tokenizer:     Any   # tokenises the text to speak
    description_tokenizer: Any  # tokenises the voice-style caption


_bundle: Optional[ModelBundle] = None


def load_bundle() -> ModelBundle:
    """Load model + both tokenizers once; cache globally."""
    global _bundle
    if _bundle is not None:
        return _bundle

    if IMPORT_ERROR is not None:
        raise RuntimeError(
            f"Indic Parler-TTS dependencies are not installed: {IMPORT_ERROR}\n"
            "Run: pip install torch transformers parler-tts soundfile"
        )

    print(f"[Parler] Loading {MODEL_ID} on {DEVICE} …")

    model = ParlerTTSForConditionalGeneration.from_pretrained(MODEL_ID).to(DEVICE)
    model.eval()

    # The prompt tokenizer tokenises the actual speech text
    prompt_tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)

    # The description tokenizer tokenises the style caption.
    # Indic Parler-TTS stores the text-encoder model name in the config;
    # fall back to the same repo if the attribute is missing.
    try:
        desc_model_id = model.config.text_encoder._name_or_path  # type: ignore[attr-defined]
        if not desc_model_id:
            raise AttributeError("empty")
    except AttributeError:
        desc_model_id = MODEL_ID  # safe fallback

    description_tokenizer = AutoTokenizer.from_pretrained(desc_model_id)

    _bundle = ModelBundle(
        model=model,
        prompt_tokenizer=prompt_tokenizer,
        description_tokenizer=description_tokenizer,
    )
    print(f"[Parler] Ready — description encoder: {desc_model_id}")
    return _bundle


# Eagerly load on startup so first request is fast
@app.on_event("startup")
async def _startup():
    try:
        load_bundle()
    except Exception as e:
        print(f"[Parler] WARNING: could not pre-load model: {e}")


# ── Request / response models ──────────────────────────────

class SynthesizeRequest(BaseModel):
    text:         str = Field(min_length=1, max_length=2500)
    languageCode: str = Field(default="hi-IN")
    style:        str = Field(default="warm friendly conversational Indian voice")


# ── Language → voice caption map ──────────────────────────

LANGUAGE_NAMES = {
    "hi": "Hindi",   "bn": "Bengali",  "gu": "Gujarati",
    "kn": "Kannada", "ml": "Malayalam","mr": "Marathi",
    "od": "Odia",    "pa": "Punjabi",  "ta": "Tamil",
    "te": "Telugu",  "ur": "Urdu",     "en": "Indian English",
}

# 69 voices in Indic Parler-TTS — pick expressive ones per language
LANGUAGE_VOICES = {
    "hi": "Rohit speaks with a warm, clear Hindi accent, a gentle pace, and expressive intonation.",
    "bn": "Priya speaks Bengali with a musical lilt, moderate pace, and clear articulation.",
    "gu": "Nisha speaks Gujarati with a soft, friendly tone and pleasant delivery.",
    "kn": "Kiran speaks Kannada with a confident, clear voice and moderate speed.",
    "ml": "Lakshmi speaks Malayalam smoothly with a warm, natural cadence.",
    "mr": "Suresh speaks Marathi with a clear, expressive, and engaging tone.",
    "od": "Ananya speaks Odia warmly with clear diction and a natural pace.",
    "pa": "Gurpreet speaks Punjabi energetically with a clear, expressive voice.",
    "ta": "Divya speaks Tamil with a melodic, clear, and pleasant delivery.",
    "te": "Arjun speaks Telugu with an expressive, warm, and confident tone.",
    "ur": "Sara speaks Urdu with a poetic, smooth, and elegant delivery.",
    "en": "Priya speaks Indian English clearly with a warm, professional tone.",
}


def build_caption(language_code: str, style: str) -> str:
    lc     = (language_code or "hi-IN").lower()
    prefix = lc[:2]
    lang   = LANGUAGE_NAMES.get(prefix, "Indian English")
    voice  = LANGUAGE_VOICES.get(prefix, LANGUAGE_VOICES["en"])
    return (
        f"{voice} "
        f"Studio-quality {lang} audio, {style}. "
        "Clear pronunciation, pleasant conversational pace, natural delivery."
    )


# ── Endpoints ──────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "ok":     True,
        "model":  MODEL_ID,
        "device": DEVICE,
        "loaded": _bundle is not None,
    }


@app.post("/synthesize")
def synthesize(payload: SynthesizeRequest):
    try:
        bundle  = load_bundle()
        caption = build_caption(payload.languageCode, payload.style)

        desc_inputs   = bundle.description_tokenizer(caption,      return_tensors="pt").to(DEVICE)
        prompt_inputs = bundle.prompt_tokenizer(payload.text,       return_tensors="pt").to(DEVICE)

        with torch.no_grad():  # type: ignore[union-attr]
            generation = bundle.model.generate(
                input_ids=desc_inputs.input_ids,
                attention_mask=desc_inputs.attention_mask,
                prompt_input_ids=prompt_inputs.input_ids,
                prompt_attention_mask=prompt_inputs.attention_mask,
            )

        audio = generation.cpu().numpy().squeeze()
        buf   = io.BytesIO()
        sf.write(buf, audio, samplerate=bundle.model.config.sampling_rate, format="WAV")
        encoded = base64.b64encode(buf.getvalue()).decode("utf-8")

        return {"audioBase64": encoded, "mimeType": "audio/wav"}

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc