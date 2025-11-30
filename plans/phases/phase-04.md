# Phase 04: XTTS-v2 Intonation Matching

## Objective
Enable prosody-preserving TTS via XTTS-v2 with a Python microservice and TypeScript client.

## Inputs
- Python runtime (Poetry) for `xtts-server/`.
- HTTP contract for `/extract-embedding`, `/synthesize`, `/health`.
- ASR output and VAD-filtered audio for embedding extraction.

## Tasks
- [ ] Scaffold `xtts-server/` with FastAPI endpoints for embedding extraction and synthesis; include Poetry dependencies (`TTS`, `fastapi`, `uvicorn`).
- [ ] Implement `XTTSClient.ts` for HTTP calls and `ProsodyExtractor.ts` for managing speaker embeddings (3–6 seconds voiced audio).
- [ ] Create `tts.worker.ts` for parallel synthesis (3 workers, one per language).
- [ ] Wire the accumulation strategy: VAD-filtered audio until embedding is locked, then reuse for all TTS calls.
- [ ] Add demo script/test that synthesizes short outputs in all 3 languages using a captured embedding.

## Outputs
- Running XTTS FastAPI service; TS client + worker pool.
- Demo/proof that prosody is preserved across languages.

## Acceptance
- `uvicorn main:app --reload --host 0.0.0.0 --port 8000` runs and responds to health.
- Test/demo synthesizes audio for es/zh/ko with shared embedding; manual check shows timbre preservation.
- Error handling covers failed synthesis with clear fallbacks.

## Constraints / Notes
- Keep Python service stateless; embeddings are supplied by the TS client per request.
- Capture embeddings only after 3–6 seconds of voiced audio; fallback to neutral voice when insufficient.
- Document expected latency per call; flag if >4s end-to-end.
