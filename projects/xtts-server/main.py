"""
XTTS-v2 TTS microservice for Voice Bridge.

Provides stateless endpoints for speaker embedding extraction and speech synthesis.
The service is designed to be called from the TypeScript client, with embeddings
managed client-side.

Usage:
    uvicorn main:app --reload --host 0.0.0.0 --port 8000

Endpoints:
    GET  /health           - Health check
    POST /extract-embedding - Extract speaker embedding from audio
    POST /synthesize       - Generate speech with embedding
"""

import base64
import io
import time
from typing import Annotated, Optional

import numpy as np
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from TTS.api import TTS

# Supported target languages (matching TypeScript client)
SUPPORTED_LANGUAGES = frozenset({"es", "zh-cn", "ko"})

# Language code mapping from client codes to XTTS codes
LANGUAGE_CODE_MAP = {
    "es": "es",
    "zh": "zh-cn",
    "zh-cn": "zh-cn",
    "ko": "ko",
}

# Expected latency thresholds (in seconds)
LATENCY_WARNING_THRESHOLD_SECONDS = 4.0

# Initialize TTS model lazily
_tts_model: Optional[TTS] = None


def get_tts_model() -> TTS:
    """Get or initialize the TTS model (singleton pattern)."""
    global _tts_model
    if _tts_model is None:
        _tts_model = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
    return _tts_model


app = FastAPI(
    title="XTTS-v2 TTS Service",
    description="Prosody-preserving text-to-speech service for Voice Bridge",
    version="0.1.0",
)

# CORS configuration for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    model_loaded: bool
    supported_languages: list[str]


class ExtractEmbeddingRequest(BaseModel):
    """Request body for embedding extraction."""

    audio_base64: Annotated[
        str,
        Field(
            description="Base64-encoded raw float32 PCM audio samples (3-6 seconds of voiced audio recommended)"
        ),
    ]
    sample_rate: Annotated[
        int, Field(default=16000, description="Sample rate of the input audio")
    ]


class ExtractEmbeddingResponse(BaseModel):
    """Response containing the extracted speaker embedding."""

    embedding_base64: Annotated[
        str, Field(description="Base64-encoded numpy array of speaker embedding")
    ]
    embedding_shape: Annotated[
        list[int], Field(description="Shape of the embedding array")
    ]
    duration_seconds: Annotated[
        float, Field(description="Duration of the input audio in seconds")
    ]
    processing_time_seconds: Annotated[
        float, Field(description="Time taken to extract embedding")
    ]


class SynthesizeRequest(BaseModel):
    """Request body for speech synthesis."""

    text: Annotated[str, Field(description="Text to synthesize")]
    language: Annotated[
        str, Field(description="Target language code (es, zh, ko)")
    ]
    embedding_base64: Annotated[
        Optional[str],
        Field(
            default=None,
            description="Base64-encoded speaker embedding. If not provided, uses neutral voice.",
        ),
    ]
    speed: Annotated[
        float, Field(default=1.0, ge=0.5, le=2.0, description="Speech speed multiplier")
    ]


class SynthesizeResponse(BaseModel):
    """Response containing synthesized audio."""

    audio_base64: Annotated[
        str, Field(description="Base64-encoded raw float32 PCM audio samples")
    ]
    sample_rate: Annotated[int, Field(description="Sample rate of output audio")]
    duration_seconds: Annotated[
        float, Field(description="Duration of synthesized audio")
    ]
    processing_time_seconds: Annotated[
        float, Field(description="Time taken to synthesize")
    ]
    latency_warning: Annotated[
        Optional[str],
        Field(
            default=None,
            description="Warning if processing time exceeded threshold",
        ),
    ]


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Check service health and model status."""
    model_loaded = _tts_model is not None
    return HealthResponse(
        status="healthy",
        model_loaded=model_loaded,
        supported_languages=list(SUPPORTED_LANGUAGES),
    )


@app.post("/extract-embedding", response_model=ExtractEmbeddingResponse)
async def extract_embedding(request: ExtractEmbeddingRequest) -> ExtractEmbeddingResponse:
    """
    Extract speaker embedding from audio.

    The embedding captures the speaker's voice characteristics and can be reused
    for multiple synthesis calls to maintain consistent timbre.

    Recommended: 3-6 seconds of clear, voiced audio for best results.
    """
    start_time = time.perf_counter()

    try:
        # Decode base64 audio
        audio_bytes = base64.b64decode(request.audio_base64)
        audio_array = np.frombuffer(audio_bytes, dtype=np.float32)

        # Calculate duration
        duration_seconds = len(audio_array) / request.sample_rate

        # Validate audio length
        if duration_seconds < 1.0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Audio too short. Minimum 1 second required.",
            )

        if duration_seconds > 30.0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Audio too long. Maximum 30 seconds allowed.",
            )

        # Get TTS model
        tts = get_tts_model()

        # Save audio to temporary buffer for TTS library
        temp_buffer = io.BytesIO()
        # Write as raw PCM - the TTS library will handle it
        temp_buffer.write(audio_array.tobytes())
        temp_buffer.seek(0)

        # Extract speaker embedding using the TTS model's speaker encoder
        # XTTS uses the speaker embedding from the synthesizer
        embedding = tts.synthesizer.tts_model.speaker_manager.compute_embedding_from_clip(
            [audio_array], sr=request.sample_rate
        )

        # Convert embedding to base64
        embedding_array = np.array(embedding, dtype=np.float32)
        embedding_bytes = embedding_array.tobytes()
        embedding_base64 = base64.b64encode(embedding_bytes).decode("utf-8")

        processing_time = time.perf_counter() - start_time

        return ExtractEmbeddingResponse(
            embedding_base64=embedding_base64,
            embedding_shape=list(embedding_array.shape),
            duration_seconds=duration_seconds,
            processing_time_seconds=processing_time,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Embedding extraction failed: {str(e)}",
        ) from e


@app.post("/synthesize", response_model=SynthesizeResponse)
async def synthesize(request: SynthesizeRequest) -> SynthesizeResponse:
    """
    Synthesize speech from text.

    Uses the provided speaker embedding for prosody matching, or falls back
    to a neutral voice if no embedding is provided.
    """
    start_time = time.perf_counter()

    try:
        # Map language code
        language = LANGUAGE_CODE_MAP.get(request.language)
        if language is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported language: {request.language}. Supported: es, zh, ko",
            )

        # Validate text
        if not request.text.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Text cannot be empty",
            )

        # Get TTS model
        tts = get_tts_model()

        # Decode speaker embedding if provided
        speaker_embedding = None
        if request.embedding_base64:
            try:
                embedding_bytes = base64.b64decode(request.embedding_base64)
                speaker_embedding = np.frombuffer(embedding_bytes, dtype=np.float32)
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid embedding format: {str(e)}",
                ) from e

        # Synthesize speech
        if speaker_embedding is not None:
            # Use speaker embedding for voice cloning
            wav = tts.tts(
                text=request.text,
                language=language,
                speaker_wav=None,
                speaker=None,
                gpt_cond_latent=speaker_embedding.reshape(1, -1) if len(speaker_embedding.shape) == 1 else speaker_embedding,
                speed=request.speed,
            )
        else:
            # Use default voice (no embedding)
            wav = tts.tts(
                text=request.text,
                language=language,
                speed=request.speed,
            )

        # Convert to numpy array
        audio_array = np.array(wav, dtype=np.float32)

        # Get sample rate from model
        sample_rate = tts.synthesizer.output_sample_rate

        # Calculate duration
        duration_seconds = len(audio_array) / sample_rate

        # Encode audio as base64
        audio_bytes = audio_array.tobytes()
        audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")

        processing_time = time.perf_counter() - start_time

        # Check for latency warning
        latency_warning = None
        if processing_time > LATENCY_WARNING_THRESHOLD_SECONDS:
            latency_warning = (
                f"Processing time ({processing_time:.2f}s) exceeded "
                f"target threshold ({LATENCY_WARNING_THRESHOLD_SECONDS}s)"
            )

        return SynthesizeResponse(
            audio_base64=audio_base64,
            sample_rate=sample_rate,
            duration_seconds=duration_seconds,
            processing_time_seconds=processing_time,
            latency_warning=latency_warning,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Synthesis failed: {str(e)}",
        ) from e


@app.on_event("startup")
async def startup_event() -> None:
    """Pre-load the TTS model on startup for faster first request."""
    # Note: Model loading is deferred to first use to reduce startup time
    # Uncomment the following line to pre-load on startup:
    # get_tts_model()
    pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
