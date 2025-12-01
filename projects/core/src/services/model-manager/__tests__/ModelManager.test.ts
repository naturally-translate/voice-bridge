import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { createModelManager } from '../ModelManager.js';
import { getModelInfo, isModelRegistered } from '../ModelRegistry.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MODELS_DIR = join(__dirname, '../../../../../../models');

describe('ModelRegistry', () => {
  describe('isModelRegistered', () => {
    it.each([
      { modelId: 'silero-vad', expected: true },
      { modelId: 'distil-whisper-large-v3', expected: true },
      { modelId: 'nllb-200-distilled-600m', expected: true },
      { modelId: 'xtts-v2', expected: true },
      { modelId: 'unknown-model', expected: false },
    ])('returns $expected for $modelId', ({ modelId, expected }) => {
      expect(isModelRegistered(modelId)).toBe(expected);
    });
  });

  describe('getModelInfo', () => {
    it.each([
      { modelId: 'silero-vad', expectedType: 'vad' },
      { modelId: 'distil-whisper-large-v3', expectedType: 'asr' },
      { modelId: 'nllb-200-distilled-600m', expectedType: 'translator' },
      { modelId: 'xtts-v2', expectedType: 'tts' },
    ])('returns correct type for $modelId', ({ modelId, expectedType }) => {
      const info = getModelInfo(modelId);
      expect(info?.type).toBe(expectedType);
    });

    it('returns undefined for unknown model', () => {
      expect(getModelInfo('unknown-model')).toBeUndefined();
    });
  });

  describe('silero-vad model file', () => {
    let modelFile: { path: string; sha256?: string } | undefined;

    beforeEach(() => {
      const info = getModelInfo('silero-vad');
      modelFile = info?.files.find((f) => f.path === 'onnx/model.onnx');
    });

    it('has onnx/model.onnx file', () => {
      expect(modelFile).toBeDefined();
    });

    it('has sha256 hash defined', () => {
      expect(modelFile?.sha256).toBeDefined();
    });

    it('has valid 64-character hex sha256 hash', () => {
      expect(modelFile?.sha256).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('xtts-v2 model', () => {
    let info: ReturnType<typeof getModelInfo>;

    beforeEach(() => {
      info = getModelInfo('xtts-v2');
    });

    it('is registered', () => {
      expect(info).toBeDefined();
    });

    it('has type tts', () => {
      expect(info?.type).toBe('tts');
    });

    it('is marked as external', () => {
      expect(info?.external).toBe(true);
    });
  });
});

describe('ModelManager', () => {
  const manager = createModelManager(MODELS_DIR);

  describe('listModels', () => {
    it('returns non-empty array', () => {
      expect(manager.listModels().length).toBeGreaterThan(0);
    });

    it('includes silero-vad', () => {
      expect(manager.listModels().some((m) => m.id === 'silero-vad')).toBe(true);
    });
  });

  describe('getModelInfo', () => {
    it('returns Silero VAD for silero-vad', () => {
      expect(manager.getModelInfo('silero-vad')?.name).toBe('Silero VAD');
    });
  });
});

describe('ModelManager - Silero VAD Download', () => {
  const manager = createModelManager(MODELS_DIR);
  const modelId = 'silero-vad';

  beforeAll(async () => {
    await manager.deleteModel(modelId);
  });

  afterAll(async () => {
    // Keep the model cached after test for future use
  });

  it('reports model as not cached initially', async () => {
    expect(await manager.isModelCached(modelId)).toBe(false);
  });

  describe('after downloading', () => {
    let modelPath: string;
    let progressUpdates: Array<{ percentage?: number; currentFile?: string }>;

    beforeAll(async () => {
      progressUpdates = [];
      modelPath = await manager.ensureModel(modelId, (progress) => {
        progressUpdates.push({
          percentage: progress.percentage,
          currentFile: progress.currentFile,
        });
      });
    });

    it('returns a path containing silero-vad', () => {
      expect(modelPath).toContain('silero-vad');
    });

    it('reports progress updates during download', () => {
      expect(progressUpdates.length).toBeGreaterThan(0);
    });

    it('reports model as cached', async () => {
      expect(await manager.isModelCached(modelId)).toBe(true);
    });

    it('returns cached path on getModelPath', async () => {
      expect(await manager.getModelPath(modelId)).toContain('silero-vad');
    });

    it('includes model in listCachedModels', async () => {
      expect(await manager.listCachedModels()).toContain(modelId);
    });
  });
});
