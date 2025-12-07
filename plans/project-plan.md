# Voice Bridge - Agent Plan

Short, agent-friendly plan. Full historical detail is preserved at `plans/archive/project-plan-2025-11-30-full.md`.

## Document Map

- Phase briefs: `plans/phases/phase-01.md` → `phase-09.md`
- Architecture summary: `plans/architecture.md`
- Backlog & file checklist: `plans/backlog.md`
- Risk register: `plans/risk-register.md`
- Decisions/history (full archive): `plans/archive/project-plan-2025-11-30-full.md`

## Goal & Scope

- Build a real-time English → {es, zh, ko} translator with **XTTS-v2 intonation matching** as the differentiator.
- Architecture: Node.js API gateway (`projects/api`, aka api-gateway) using `worker_threads`; React web client (browser); GraphQL control + binary WebSocket audio.
- Models: Distil-Whisper V3 (ASR), NLLB-200 distilled 600M (translation), XTTS-v2 Python microservice (TTS), Silero VAD.

## Phases

1. [Phase 01: Foundation & Core Abstractions](phases/phase-01.md) — Boot toolchain, enforce strict TypeScript, and prove model downloads with ModelManager.
2. [Phase 02: ASR + VAD](phases/phase-02.md) — Deliver streaming voice activity detection and speech recognition with audio utilities.
3. [Phase 03: Translation with Worker Threads](phases/phase-03.md) — Provide parallel NLLB translation for three target languages via worker threads.
4. [Phase 04: XTTS-v2 Intonation Matching](phases/phase-04.md) — Enable prosody-preserving TTS via XTTS-v2 Python microservice and TypeScript client.
5. [Phase 05: Pipeline Orchestration](phases/phase-05.md) — Orchestrate VAD → ASR → Translation → TTS with fire-and-forget language isolation.
6. [Phase 06: GraphQL API & WebSocket Server](phases/phase-06.md) — Expose the pipeline over GraphQL and binary WebSockets with multi-client support.
7. [Phase 07: React Web Client](phases/phase-07.md) — Ship a React/MUI web app for session control, audio streaming, and per-language playback.
8. [Phase 08: Recording Storage & Playback](phases/phase-08.md) — Persist session artifacts via pluggable storage and expose recording playback.
9. [Phase 09: Testing & Optimization](phases/phase-09.md) — Harden the system with comprehensive tests, profiling, and resilience improvements.

## Constraints & Target Platform

- Runtimes via ASDF: Node 22.12.x (LTS), Python 3.11.9, pnpm 10.12.x. UV for Python package management.
- Primary dev target: Apple Silicon 16GB RAM; production must remain cross-platform (macOS/Windows/Linux).
- Keep audio transport on binary WebSockets (no WebRTC); control/text on GraphQL.

## Key Decisions (see archive for rationale)

- API gateway (Node.js) with `worker_threads`; React web client in browser.
- XTTS-v2 runs as a Python FastAPI microservice; TypeScript talks via HTTP.
- Per-language isolation: separate workers and audio channels; fire-and-forget (one language failing does not block others).
- On-demand model downloads to `models/` via Transformers.js.
- Simple ffmpeg pipeline via `@ffmpeg-installer/ffmpeg` + `fluent-ffmpeg`.
- All sessions are recorded via a storage abstraction (`IRecordingStorage`).

## Top Risks (details in `plans/risk-register.md`)

- XTTS latency/quality on Apple Silicon could exceed target (<4s end-to-end).
- Memory pressure when 3× NLLB + ASR + TTS run concurrently.
- Binary audio streaming correctness (chunking/resampling) across client/API gateway.

## Immediate Next Steps (agents)

- Work from `plans/phases/phase-01.md` and the priority backlog in `plans/backlog.md`.
- Keep outputs/tests explicit in each phase file; update checkboxes when completing tasks.
- Only pull from the full archive when additional rationale or diagrams are needed.
