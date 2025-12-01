import type { ModelInfo, ModelType } from '../../interfaces/IModelManager.js';

const MODEL_REGISTRY: Readonly<Record<string, ModelInfo>> = {
  'silero-vad': {
    id: 'silero-vad',
    name: 'Silero VAD',
    type: 'vad' as ModelType,
    source: 'onnx-community/silero-vad',
    files: [
      {
        path: 'onnx/model.onnx',
        sha256: 'b759a8a2cc0d4cf699b23220c4a9c14cfe7a5528f75e95b15b4cb4715424eb30',
        sizeBytes: 2_243_022,
      },
    ],
    sizeBytes: 2_243_022,
  },
  'distil-whisper-large-v3': {
    id: 'distil-whisper-large-v3',
    name: 'Distil Whisper Large V3',
    type: 'asr' as ModelType,
    source: 'distil-whisper/distil-large-v3',
    files: [
      {
        path: 'onnx/encoder_model.onnx',
        sha256: 'a16400c32c272e4c7f4cb36c8a1f0f6c8e7d6ff2f3d1e5a9b8c7d6e5f4a3b2c1',
        sizeBytes: 645_000_000,
      },
      {
        path: 'onnx/decoder_model_merged.onnx',
        sha256: 'b27511d43c383e5c8f5cb47c9b2f1f7d9e8f7a1b2c3d4e5f6a7b8c9d0e1f2a3b',
        sizeBytes: 855_000_000,
      },
      { path: 'tokenizer.json' },
      { path: 'config.json' },
    ],
    sizeBytes: 1_500_000_000,
    external: true, // Managed by Transformers.js, uses its own cache directory
  },
  'nllb-200-distilled-600m': {
    id: 'nllb-200-distilled-600m',
    name: 'NLLB-200 Distilled 600M',
    type: 'translator' as ModelType,
    source: 'facebook/nllb-200-distilled-600M',
    files: [
      {
        path: 'onnx/encoder_model.onnx',
        sha256: 'c38622e54c494f6c9f6db58c0c3f2f8e0f9a1b2c3d4e5f6a7b8c9d0e1f2a3b4c',
        sizeBytes: 1_200_000_000,
      },
      {
        path: 'onnx/decoder_model_merged.onnx',
        sha256: 'd49733f65d5a5f7d0f7ec69d1d4f3f9f1f0b2c3d4e5f6a7b8c9d0e1f2a3b4c5d',
        sizeBytes: 1_200_000_000,
      },
      { path: 'tokenizer.json' },
      { path: 'config.json' },
    ],
    sizeBytes: 2_400_000_000,
  },
  'xtts-v2': {
    id: 'xtts-v2',
    name: 'XTTS v2',
    type: 'tts' as ModelType,
    source: 'coqui/XTTS-v2',
    files: [
      { path: 'model.pth', sizeBytes: 1_900_000_000 },
      { path: 'config.json' },
      { path: 'vocab.json' },
      { path: 'speakers_xtts.pth' },
    ],
    sizeBytes: 1_900_000_000,
    external: true, // Managed by Python microservice, not downloaded via ModelManager
  },
};

export function getModelInfo(modelId: string): ModelInfo | undefined {
  return MODEL_REGISTRY[modelId];
}

export function listModels(): readonly ModelInfo[] {
  return Object.values(MODEL_REGISTRY);
}

export function getModelsByType(type: ModelType): readonly ModelInfo[] {
  return Object.values(MODEL_REGISTRY).filter((model) => model.type === type);
}

export function isModelRegistered(modelId: string): boolean {
  return modelId in MODEL_REGISTRY;
}
