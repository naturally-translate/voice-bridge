import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import type {
  DownloadProgressCallback,
  IModelManager,
  ModelInfo,
} from "../../interfaces/IModelManager.js";
import { getModelInfo, listModels } from "./ModelRegistry.js";

const HUGGING_FACE_MODEL_BASE_URL = "https://huggingface.co";

export interface ModelManagerOptions {
  readonly cacheDir: string;
}

interface DownloadFileOptions {
  readonly url: string;
  readonly destPath: string;
  readonly onProgress?: (bytes: number, total?: number) => void;
}

export class ModelManager implements IModelManager {
  private readonly cacheDir: string;

  constructor(options: ModelManagerOptions) {
    this.cacheDir = options.cacheDir;
  }

  async isModelCached(modelId: string): Promise<boolean> {
    const modelPath = await this.getModelPath(modelId);
    return modelPath !== undefined;
  }

  async getModelPath(modelId: string): Promise<string | undefined> {
    const info = getModelInfo(modelId);
    if (!info) {
      return undefined;
    }

    const modelDir = join(this.cacheDir, modelId);

    try {
      const stats = await stat(modelDir);
      if (!stats.isDirectory()) {
        return undefined;
      }

      // Check if all required files exist
      for (const file of info.files) {
        const filePath = join(modelDir, file.path);
        try {
          await stat(filePath);
        } catch {
          return undefined;
        }
      }

      return modelDir;
    } catch {
      return undefined;
    }
  }

  async ensureModel(
    modelId: string,
    onProgress?: DownloadProgressCallback
  ): Promise<string> {
    const existingPath = await this.getModelPath(modelId);
    if (existingPath) {
      return existingPath;
    }

    const info = getModelInfo(modelId);
    if (!info) {
      throw new Error(`Unknown model: ${modelId}`);
    }

    if (info.external) {
      throw new Error(
        `Model ${modelId} is managed externally and cannot be downloaded via ModelManager`
      );
    }

    const modelDir = join(this.cacheDir, modelId);
    await mkdir(modelDir, { recursive: true });

    let totalDownloaded = 0;

    for (const file of info.files) {
      const filePath = join(modelDir, file.path);
      await mkdir(dirname(filePath), { recursive: true });

      const url = `${HUGGING_FACE_MODEL_BASE_URL}/${info.source}/resolve/main/${file.path}`;

      const downloaded = await this.downloadFile({
        url,
        destPath: filePath,
        onProgress: (bytes) => {
          if (onProgress) {
            onProgress({
              modelId,
              downloadedBytes: totalDownloaded + bytes,
              currentFile: file.path,
              ...(info.sizeBytes !== undefined && {
                totalBytes: info.sizeBytes,
                percentage: Math.round(
                  ((totalDownloaded + bytes) / info.sizeBytes) * 100
                ),
              }),
            });
          }
        },
      });

      totalDownloaded += downloaded;
    }

    return modelDir;
  }

  async deleteModel(modelId: string): Promise<void> {
    const modelDir = join(this.cacheDir, modelId);
    try {
      await rm(modelDir, { recursive: true, force: true });
    } catch {
      // Ignore errors if directory doesn't exist
    }
  }

  getModelInfo(modelId: string): ModelInfo | undefined {
    return getModelInfo(modelId);
  }

  listModels(): readonly ModelInfo[] {
    return listModels();
  }

  async listCachedModels(): Promise<readonly string[]> {
    try {
      const entries = await readdir(this.cacheDir, { withFileTypes: true });
      const cached: string[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const isCached = await this.isModelCached(entry.name);
          if (isCached) {
            cached.push(entry.name);
          }
        }
      }

      return cached;
    } catch {
      return [];
    }
  }

  private async downloadFile(options: DownloadFileOptions): Promise<number> {
    const { url, destPath, onProgress } = options;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "voice-bridge/1.0.0",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to download ${url}: ${response.status} ${response.statusText}`
      );
    }

    const contentLength = response.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength, 10) : undefined;

    if (!response.body) {
      throw new Error(`No response body for ${url}`);
    }

    const reader = response.body.getReader();
    const writeStream = createWriteStream(destPath);

    let downloadedBytes = 0;

    const readable = new Readable({
      async read() {
        try {
          const { done, value } = await reader.read();
          if (done) {
            this.push(null);
            return;
          }
          downloadedBytes += value.byteLength;
          if (onProgress) {
            onProgress(downloadedBytes, totalBytes);
          }
          this.push(Buffer.from(value));
        } catch (error) {
          this.destroy(
            error instanceof Error ? error : new Error(String(error))
          );
        }
      },
    });

    await pipeline(readable, writeStream);

    return downloadedBytes;
  }
}

export function createModelManager(cacheDir: string): ModelManager {
  return new ModelManager({ cacheDir });
}
