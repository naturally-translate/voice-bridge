/**
 * Pipeline service exports.
 */

// Main pipeline
export {
  TranslationPipeline,
  createTranslationPipeline,
  type PipelineInitOptions,
  type MetricsEventListener,
  type ThresholdAlertEvent,
  type ThresholdAlertListener,
} from "./TranslationPipeline.js";

// Context
export {
  PipelineContext,
  createPipelineContext,
  type PipelineContextOptions,
  type SessionState,
  type SessionInfo,
  type ProsodyEventListener,
} from "./PipelineContext.js";

// Metrics
export {
  PipelineMetrics,
  createPipelineMetrics,
  type PipelineMetricsConfig,
  type MetricsSnapshot,
  type ThresholdViolation,
} from "./PipelineMetrics.js";

// Types
export {
  // Target languages
  TARGET_LANGUAGES,
  type TargetLanguage,

  // Pipeline stages
  type PipelineStage,

  // Events
  type PipelineEvent,
  type VADPipelineEvent,
  type TranscriptionPipelineEvent,
  type TranslationPipelineEvent,
  type SynthesisPipelineEvent,
  type ErrorPipelineEvent,
  type MetricsPipelineEvent,
  type ProsodyPipelineEvent,

  // Configuration
  type PipelineConfig,
  type TranslationPipelineOptions,
  type PipelineAudioMetadata,
  DEFAULT_PIPELINE_CONFIG,

  // Metrics types
  type LatencyMetrics,
  type PerLanguageLatency,
  type LanguageStatus,

  // Results
  type AllLanguagesTranslationResult,
  type AllLanguagesSynthesisResult,

  // Metadata
  type SegmentMetadata,
  type TranscriptionMetadata,

  // Utilities
  isTargetLanguage,
  generateId,
  getTimestamp,
  isError,

  // Re-exported types
  type SpeakerEmbedding,
} from "./PipelineTypes.js";
