# XTTS-v2 TTS Server

Stateless FastAPI microservice for prosody-preserving text-to-speech using XTTS-v2.

## Requirements

- Python 3.11.9
- UV (install via `curl -LsSf https://astral.sh/uv/install.sh | sh` or `brew install uv`)

## Installation

```bash
cd projects/xtts-server
uv sync
```

For development dependencies:

```bash
uv sync --group dev
```

## Usage

Start the server:

```bash
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Verification / Demo (embedding reuse)

With the server running, you can generate a speaker embedding and reuse it across Spanish/Chinese/Korean in one shot:

```bash
uv run python verify.py
```

This will:
- hit `/health`
- generate a synthetic 4s clip to call `/extract-embedding`
- call `/synthesize` for es/zh/ko using the captured embedding
- write WAV files to `projects/xtts-server/test_output/test_<lang>_with_embedding.wav`

## Endpoints

### Health Check

```
GET /health
```

Returns service status and loaded model information.

### Extract Embedding

```
POST /extract-embedding
```

Extracts speaker embedding from 3-6 seconds of voiced audio. The embedding captures
voice characteristics for consistent synthesis.

Request body:
```json
{
  "audio_base64": "<base64-encoded float32 PCM audio>",
  "sample_rate": 16000
}
```

### Synthesize

```
POST /synthesize
```

Generates speech from text with optional speaker embedding.

Request body:
```json
{
  "text": "Hello world",
  "language": "es",
  "embedding_base64": "<optional base64 embedding>",
  "speed": 1.0
}
```

Supported languages: `es` (Spanish), `zh` (Chinese), `ko` (Korean)

## Performance

Target latency: < 4 seconds end-to-end per synthesis call.

The server logs a warning if processing time exceeds this threshold.

## Architecture

The service is stateless. Speaker embeddings are managed by the TypeScript client
and passed per request. This allows horizontal scaling and simple deployment.
