# Phase 03: Translation with Worker Threads

## Objective
Provide parallel NLLB translation for three target languages via worker threads.

## Inputs
- Interfaces + audio utilities from prior phases.
- Model: `facebook/nllb-200-distilled-600M`.

## Tasks
- [ ] Implement `NLLBTranslator.ts` for English → {es, zh, ko}; start with single-shot, then streaming.
- [ ] Create worker entry `translation.worker.ts` hosting a single NLLB instance.
- [ ] Implement `worker-pool.ts` to manage three workers with task queuing and per-language isolation.
- [ ] Add memory profiling for loading 3× NLLB instances; target ~1.8GB total.
- [ ] Add boundary/integration tests for translation and worker pool behavior (queueing, shutdown).

## Outputs
- Translation service callable from main thread via worker pool.
- Memory usage notes for 3 workers.

## Acceptance
- `pnpm test --filter translation` (or equivalent) passes, covering worker pool queueing and translation correctness on sample sentences.
- 3 workers load without OOM on Apple Silicon 16GB; record observed RSS.

## Constraints / Notes
- Keep message payloads small (text only) between main thread and workers.
- Each language worker should be independent; failure in one should not block others (fire-and-forget).
