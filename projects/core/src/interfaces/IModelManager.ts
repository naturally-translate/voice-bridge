export type ModelType = 'vad' | 'asr' | 'translator' | 'tts';

export interface ModelFileInfo {
  readonly path: string;
  readonly sha256?: string;
  readonly sizeBytes?: number;
}

export interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly type: ModelType;
  readonly source: string;
  readonly files: readonly ModelFileInfo[];
  readonly sizeBytes?: number;
  readonly external?: boolean;
}

export interface DownloadProgress {
  readonly modelId: string;
  readonly downloadedBytes: number;
  readonly totalBytes?: number;
  readonly percentage?: number;
  readonly currentFile?: string;
}

export type DownloadProgressCallback = (progress: Readonly<DownloadProgress>) => void;

export interface IModelManager {
  isModelCached(modelId: string): Promise<boolean>;
  getModelPath(modelId: string): Promise<string | undefined>;
  ensureModel(modelId: string, onProgress?: DownloadProgressCallback): Promise<string>;
  deleteModel(modelId: string): Promise<void>;
  getModelInfo(modelId: string): ModelInfo | undefined;
  listModels(): readonly ModelInfo[];
  listCachedModels(): Promise<readonly string[]>;
}
