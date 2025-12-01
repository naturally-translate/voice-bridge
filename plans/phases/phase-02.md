# Phase 02: ASR + VAD

## Objective

Deliver streaming VAD and ASR with audio utilities to prep inputs for the pipeline.

## Inputs

- Interfaces from Phase 01.
- Audio fixtures for silence vs speech.
- ffmpeg via `@ffmpeg-installer/ffmpeg` + `fluent-ffmpeg`.

## Tasks

- [ ] Implement `SileroVAD.ts` using `@ricky0123/vad-node` (or equivalent) with streaming chunk support.
- [ ] Implement `DistilWhisperASR.ts` using Transformers.js with model `distil-whisper/distil-large-v3`.
- [ ] Add audio utilities under `projects/api/src/audio/`: `AudioBuffer.ts` (circular), `AudioConverter.ts` (format conversion), `AudioResampler.ts` (16kHz for ASR).
- [ ] Create audio fixtures and boundary tests for VAD (speech vs silence) and ASR (short utterance).
- [ ] Ensure resampling/mono conversion is consistent before ASR.

## Outputs

- VAD and ASR services that stream partial/final results.
- Audio utility helpers compiled and tested.

## Acceptance

- `pnpm test --filter vad` and `--filter asr` pass with fixture coverage.
- ASR produces partial + final transcripts for a sample WAV; VAD drops silence chunks.
- `pnpm -C projects/api tsc --noEmit` still passes.

## Constraints / Notes

- Keep ASR streaming chunks aligned (e.g., 20–40ms frames) to minimize latency.
- Ensure ffmpeg binaries resolve correctly on Apple Silicon; document any flags needed.
