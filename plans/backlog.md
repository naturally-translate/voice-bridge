# Backlog & File Checklist

Prioritized checklist derived from the full plan. Use alongside phase briefs.

## Priority 0 — Phase 1

- [ ] `tsconfig.base.json`
- [ ] `projects/server/tsconfig.json`
- [ ] `projects/server/package.json` (deps: @huggingface/transformers, @ffmpeg-installer/ffmpeg, fluent-ffmpeg, ws, comlink, apollo)
- [ ] `projects/server/vite.config.ts`
- [ ] `projects/server/src/interfaces/ITTS.ts`
- [ ] `projects/server/src/interfaces/IASR.ts`
- [ ] `projects/server/src/interfaces/ITranslator.ts`
- [ ] `projects/server/src/interfaces/IModelManager.ts`
- [ ] `projects/server/src/services/model-manager/ModelRegistry.ts`
- [ ] `projects/server/src/services/model-manager/ModelManager.ts`

## Priority 1 — Phase 2-3

- [ ] `projects/server/src/services/vad/SileroVAD.ts`
- [ ] `projects/server/src/services/asr/DistilWhisperASR.ts`
- [ ] `projects/server/src/services/translation/NLLBTranslator.ts`
- [ ] `projects/server/src/workers/translation.worker.ts`
- [ ] `projects/server/src/workers/worker-pool.ts`

## Priority 2 — Phase 4

- [ ] `xtts-server/main.py`
- [ ] `xtts-server/pyproject.toml`
- [ ] `projects/server/src/services/tts/XTTSClient.ts`
- [ ] `projects/server/src/services/tts/ProsodyExtractor.ts`

## Priority 3 — Phase 5-6

- [ ] `projects/server/src/pipeline/TranslationPipeline.ts`
- [ ] `projects/server/src/schema/schema.graphql`
- [ ] `projects/server/src/server.ts`
- [ ] `projects/server/src/resolvers/Subscription.ts`

## Priority 4 — Phase 7

- [ ] `projects/web-client/vite.config.ts`
- [ ] `projects/web-client/src/apollo/client.ts`
- [ ] `projects/web-client/src/components/TranslationView/TranslationView.tsx`

## Priority 5 — Phase 8

- [ ] `projects/server/src/interfaces/IRecordingStorage.ts`
- [ ] `projects/server/src/services/storage/LocalFileStorage.ts`
- [ ] `projects/server/src/services/storage/TranscriptFormatter.ts`
- [ ] `projects/server/src/services/storage/AudioConcatenator.ts`
- [ ] `projects/server/src/services/storage/SessionFinalizer.ts`
