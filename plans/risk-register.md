# Risk Register (concise)

See `plans/archive/project-plan-2025-11-30-full.md` for historical detail.

- **XTTS latency/quality on Apple Silicon**
  - Impact: End-to-end latency >4s; poor prosody.
  - Mitigation: Benchmark early with short clips; cache embeddings; tune chunk sizes; consider GPU/remote XTTS if needed.

- **Memory pressure with 3× NLLB + ASR + TTS**
  - Impact: OOM/slowdown on 16GB dev machines.
  - Mitigation: Load/retain models only per active language; measure RSS; stagger worker init; document minimum RAM.

- **Binary audio streaming/resampling bugs**
  - Impact: Corrupted audio, mistranscriptions, or silence.
  - Mitigation: Standardize chunk sizes (20–40ms); enforce 16kHz mono before ASR; add integration tests for WebSocket I/O; log dropouts.

- **Model download failures/slow links**
  - Impact: Setup blocks; partial downloads.
  - Mitigation: Resume/support hashed artifacts; allow configurable cache path; provide offline instructions.

- **Web Audio / AudioWorklet compatibility**
  - Impact: Mic capture latency or browser incompatibility.
  - Mitigation: Feature-detect; offer fallback capture path; document tested browsers (Chrome/Safari).
