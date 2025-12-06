# Backlog & File Checklist

Prioritized checklist derived from the full plan. Use alongside phase briefs.
API gateway lives at `projects/api` (formerly referenced as `projects/server` in earlier drafts).

## Priority 0 — Phase 1

- [ ] `tsconfig.base.json`
- [ ] `projects/api/tsconfig.json`
- [ ] `projects/api/package.json` (deps: @huggingface/transformers, @ffmpeg-installer/ffmpeg, fluent-ffmpeg, ws, comlink, apollo)
- [ ] `projects/api/vite.config.ts`
- [ ] `projects/api/src/interfaces/ITTS.ts`
- [ ] `projects/api/src/interfaces/IASR.ts`
- [ ] `projects/api/src/interfaces/ITranslator.ts`
- [ ] `projects/api/src/interfaces/IModelManager.ts`
- [ ] `projects/api/src/services/model-manager/ModelRegistry.ts`
- [ ] `projects/api/src/services/model-manager/ModelManager.ts`

## Priority 1 — Phase 2-3

- [ ] `projects/api/src/services/vad/SileroVAD.ts`
- [ ] `projects/api/src/services/asr/DistilWhisperASR.ts`
- [ ] `projects/api/src/services/translation/NLLBTranslator.ts`
- [ ] `projects/api/src/workers/translation.worker.ts`
- [ ] `projects/api/src/workers/worker-pool.ts`
- [ ] `projects/core/src/services/translation/worker-pool.ts` — add init timeout/cleanup, allow abort of in-flight tasks, refresh streaming timeouts, and ensure worker path resolves without a prebuild
- [ ] `projects/core/src/services/translation/__tests__/worker-pool.test.ts` — cover queue overflow, restart, and timeout behavior
- [ ] `plans/phases/phase-03.md` — record translation memory/RSS notes and align model choice with implemented `Xenova/nllb-200-distilled-600M`

## Priority 2 — Phase 4

- [ ] `xtts-server/main.py`
- [ ] `xtts-server/pyproject.toml`
- [ ] `projects/api/src/services/tts/XTTSClient.ts`
- [ ] `projects/api/src/services/tts/ProsodyExtractor.ts`

## Priority 3 — Phase 5-6

- [ ] `projects/api/src/pipeline/TranslationPipeline.ts`
- [ ] `projects/api/src/schema/schema.graphql`
- [ ] `projects/api/src/server.ts`
- [ ] `projects/api/src/resolvers/Subscription.ts`

## Priority 4 — Phase 7

- [ ] `projects/client-app/vite.config.ts`
- [ ] `projects/client-app/src/apollo/client.ts`
- [ ] `projects/client-app/src/components/TranslationView/TranslationView.tsx`

## Priority 5 — Phase 8

- [ ] `projects/api/src/interfaces/IRecordingStorage.ts`
- [ ] `projects/api/src/services/storage/LocalFileStorage.ts`
- [ ] `projects/api/src/services/storage/TranscriptFormatter.ts`
- [ ] `projects/api/src/services/storage/AudioConcatenator.ts`
- [ ] `projects/api/src/services/storage/SessionFinalizer.ts`
