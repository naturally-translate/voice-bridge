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
- Architecture: Node.js server with `worker_threads`, React web client (browser), GraphQL control + binary WebSocket audio.
- Models: Distil-Whisper V3 (ASR), NLLB-200 distilled 600M (translation), XTTS-v2 Python microservice (TTS), Silero VAD.

## Active Phase

- **Phase 1: Foundation & Core Abstractions**
  - Target: TypeScript configs, dependencies installed, core interfaces, ModelManager with on-demand downloads, first boundary test.
  - Success: Server package compiles; Silero VAD download works; tests green for ModelManager.

## Upcoming Milestones

- M1: Phase 1 complete (baseline tooling + model download path proven).
- M2: Phase 2 (ASR + VAD streaming path validated with audio fixtures).
- M3: Phase 3 (NLLB worker pool translating 3 languages in parallel).
- M4: Phase 4 (XTTS intonation demo showing prosody preservation).

## Constraints & Target Platform

- Runtimes via ASDF: Node 22.12.x (LTS), Python 3.11.9, Poetry 1.8.3, pnpm 10.12.x.
- Primary dev target: Apple Silicon 16GB RAM; production must remain cross-platform (macOS/Windows/Linux).
- Keep audio transport on binary WebSockets (no WebRTC); control/text on GraphQL.

## Key Decisions (see archive for rationale)

- Node.js server with `worker_threads`; React web client in browser.
- XTTS-v2 runs as a Python FastAPI microservice; TypeScript talks via HTTP.
- Per-language isolation: separate workers and audio channels; fire-and-forget (one language failing does not block others).
- On-demand model downloads to `models/` via Transformers.js.
- Simple ffmpeg pipeline via `@ffmpeg-installer/ffmpeg` + `fluent-ffmpeg`.
- All sessions are recorded via a storage abstraction (`IRecordingStorage`).

## Top Risks (details in `plans/risk-register.md`)

- XTTS latency/quality on Apple Silicon could exceed target (<4s end-to-end).
- Memory pressure when 3× NLLB + ASR + TTS run concurrently.
- Binary audio streaming correctness (chunking/resampling) across client/server.

## Immediate Next Steps (agents)

- Work from `plans/phases/phase-01.md` and the priority backlog in `plans/backlog.md`.
- Keep outputs/tests explicit in each phase file; update checkboxes when completing tasks.
- Only pull from the full archive when additional rationale or diagrams are needed.
