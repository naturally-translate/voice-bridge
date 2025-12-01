# Phase 05: Pipeline Orchestration

## Objective

Orchestrate VAD → ASR → Translation → TTS with fire-and-forget language isolation.

## Inputs

- Services from phases 1–4.
- Event bus/pubsub abstraction for status updates.

## Tasks

- [ ] Implement `TranslationPipeline.ts` coordinating VAD, ASR, translation workers, and TTS workers.
- [ ] Create `PipelineContext` to hold session config, speaker embedding, active languages, and shared state.
- [ ] Add fire-and-forget handling: one language failure must not block others.
- [ ] Add metrics/telemetry hooks for latency and errors.
- [ ] Write end-to-end pipeline tests with sample audio; record latency (<4s target) and memory (<10GB target).

## Outputs

- Pipeline module exposing async generator/stream of events for UI/API consumption.
- Benchmarks for latency and memory under 3-language load.

## Acceptance

- End-to-end test passes, producing transcripts + synthesized audio for all languages.
- Observed latency and memory recorded; regressions flagged if over targets.
- Pipeline handles worker failure by degrading per-language instead of crashing.

## Constraints / Notes

- Avoid shared mutable state between language workers; use messages/events.
- Ensure clean shutdown/cleanup of workers between sessions.
