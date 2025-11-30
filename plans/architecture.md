# Architecture Summary

Use this as the concise reference for agents. Full diagrams and deep detail live in `plans/archive/project-plan-2025-11-30-full.md`.

## Layering

- **Client (browser)**: React + TS + MUI; Apollo Client for GraphQL control/text; Web Audio API for capture; WebSocket clients for binary audio in/out; per-language audio players.
- **API**: Apollo Server (GraphQL queries/mutations/subscriptions) for control and text streaming; separate binary WebSocket server for audio input and per-language outputs.
- **Core (Node.js + worker_threads)**: VAD (Silero), ASR (Distil-Whisper V3), Translation (3× NLLB-200 distilled 600M workers), TTS (3× XTTS client workers), ModelManager, Pipeline orchestrator, Session manager, PubSub/Event bus.
- **External service**: XTTS-v2 Python FastAPI microservice for prosody extraction and synthesis.
- **Storage**: Pluggable `IRecordingStorage`; initial `LocalFileStorage` writing audio + transcripts + metadata under `models/` and recording base paths.

## Data Flow (happy path)

1. Client captures microphone audio → binary WebSocket input.
2. Server runs VAD → ASR → Translation (3 workers) → TTS (3 workers) with fire-and-forget per language.
3. Text results stream over GraphQL subscriptions; audio streams back via per-language WebSockets.
4. Recording hooks persist input/output audio, transcripts, embedding, and metadata.

## Key Contracts

- GraphQL controls text; audio stays on binary WebSockets.
- Per-language isolation for translation and TTS; one failure does not block others.
- Model downloads are on-demand via Transformers.js into `models/`.
- Session metadata and artifacts stored per-session folder (`{yyyy-mm}/{timestamp-name}/...`).

## Deployment Notes

- Primary dev target: Apple Silicon 16GB; production must remain cross-platform.
- Server can run local/LAN/cloud; multiple browser clients can connect to one server.
- XTTS service runs alongside Node server; communicate via HTTP.
