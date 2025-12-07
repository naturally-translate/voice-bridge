/**
 * TTS service exports.
 */

// Client
export {
  XTTSClient,
  createXTTSClient,
  type XTTSClientOptions,
  type SpeakerEmbedding,
  type XTTSHealthResponse,
  type SynthesizeOptions,
  type ExtractEmbeddingOptions,
  type TTSTargetLanguage,
} from "./XTTSClient.js";

// Prosody Extractor
export {
  ProsodyExtractor,
  createProsodyExtractor,
  type ProsodyExtractorOptions,
  type ProsodyExtractorState,
  type ProsodyStateChangeEvent,
  type ProsodyStateChangeListener,
} from "./ProsodyExtractor.js";

// Worker Pool
export {
  TTSWorkerPool,
  createTTSWorkerPool,
  type TTSWorkerPoolOptions,
  type TTSRequestOptions,
  type TTSTargetLanguage as WorkerPoolTargetLanguage,
} from "./worker-pool.js";
