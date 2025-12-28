/**
 * Mock Model Manager for pipeline testing.
 * Simulates model management without real downloads.
 */

import type {
  IModelManager,
  ModelInfo,
  DownloadProgressCallback,
} from "../../../../interfaces/IModelManager.js";

/**
 * Options for MockModelManager.
 */
export interface MockModelManagerOptions {
  /** Simulated latency in ms. Default: 0 */
  readonly latencyMs?: number;
}

/**
 * Mock model manager for fast testing.
 */
export class MockModelManager implements IModelManager {
  private readonly latencyMs: number;
  private readonly cachedModels = new Set<string>();

  constructor(options?: Readonly<MockModelManagerOptions>) {
    this.latencyMs = options?.latencyMs ?? 0;
  }

  async isModelCached(modelId: string): Promise<boolean> {
    return this.cachedModels.has(modelId);
  }

  async getModelPath(modelId: string): Promise<string | undefined> {
    if (this.cachedModels.has(modelId)) {
      return `/mock/models/${modelId}`;
    }
    return undefined;
  }

  async ensureModel(
    modelId: string,
    _onProgress?: DownloadProgressCallback
  ): Promise<string> {
    if (this.latencyMs > 0) {
      await this.delay(this.latencyMs);
    }
    this.cachedModels.add(modelId);
    return `/mock/models/${modelId}`;
  }

  async deleteModel(modelId: string): Promise<void> {
    this.cachedModels.delete(modelId);
  }

  getModelInfo(_modelId: string): ModelInfo | undefined {
    return undefined;
  }

  listModels(): readonly ModelInfo[] {
    return [];
  }

  async listCachedModels(): Promise<readonly string[]> {
    return [...this.cachedModels];
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createMockModelManager(
  options?: Readonly<MockModelManagerOptions>
): MockModelManager {
  return new MockModelManager(options);
}
