/**
 * Type definitions for the Translation Pipeline.
 * Defines all events, configuration, and shared types.
 */

import type { VADSegment } from "../../interfaces/IVAD.js";
import type { ASRResult } from "../../interfaces/IASR.js";
import type { TranslationResult } from "../../interfaces/ITranslator.js";
import type { TTSResult } from "../../interfaces/ITTS.js";
import type { SpeakerEmbedding } from "../tts/XTTSClient.js";

/**
 * Supported target languages for the translation pipeline.
 */
export const TARGET_LANGUAGES = ["es", "zh", "ko"] as const;
export type TargetLanguage = (typeof TARGET_LANGUAGES)[number];

/**
 * Pipeline stage identifiers.
 */
export type PipelineStage = "vad" | "asr" | "translation" | "synthesis";

/**
 * Language-specific status tracking.
 */
export interface LanguageStatus {
  readonly language: TargetLanguage;
  readonly isActive: boolean;
  readonly lastSuccessTimestamp: number | null;
  readonly lastErrorTimestamp: number | null;
  readonly errorCount: number;
  readonly successCount: number;
}

/**
 * VAD event emitted when speech is detected.
 */
export interface VADPipelineEvent {
  readonly type: "vad";
  readonly timestamp: number;
  readonly segment: VADSegment;
  readonly isPartial: boolean;
  /** Audio samples for this segment, if available */
  readonly audio?: Float32Array;
}

/**
 * Transcription event emitted after ASR processing.
 */
export interface TranscriptionPipelineEvent {
  readonly type: "transcription";
  readonly timestamp: number;
  readonly result: ASRResult;
  readonly isPartial: boolean;
  /** Reference to the VAD segment that produced this transcription */
  readonly segmentId: string;
}

/**
 * Translation event emitted after translation processing.
 */
export interface TranslationPipelineEvent {
  readonly type: "translation";
  readonly timestamp: number;
  readonly targetLanguage: TargetLanguage;
  readonly result: TranslationResult;
  readonly isPartial: boolean;
  /** Reference to the transcription that produced this translation */
  readonly transcriptionId: string;
}

/**
 * Synthesis event emitted after TTS processing.
 */
export interface SynthesisPipelineEvent {
  readonly type: "synthesis";
  readonly timestamp: number;
  readonly targetLanguage: TargetLanguage;
  readonly result: TTSResult;
  /** Reference to the translation that produced this synthesis */
  readonly translationId: string;
}

/**
 * Error event emitted when a stage fails.
 * For language-specific failures, includes the target language.
 */
export interface ErrorPipelineEvent {
  readonly type: "error";
  readonly timestamp: number;
  readonly stage: PipelineStage;
  readonly error: Error;
  /** Target language if this is a language-specific error */
  readonly targetLanguage?: TargetLanguage;
  /** Whether the pipeline can continue processing */
  readonly recoverable: boolean;
}

/**
 * Metrics event emitted periodically with performance data.
 */
export interface MetricsPipelineEvent {
  readonly type: "metrics";
  readonly timestamp: number;
  readonly latencyMs: LatencyMetrics;
  readonly memoryMB: number;
  readonly languageStatus: ReadonlyMap<TargetLanguage, LanguageStatus>;
  /** True if any threshold was exceeded */
  readonly thresholdViolation: boolean;
}

/**
 * Prosody event emitted when speaker embedding state changes.
 */
export interface ProsodyPipelineEvent {
  readonly type: "prosody";
  readonly timestamp: number;
  readonly state: "accumulating" | "extracting" | "locked" | "error";
  readonly progress: number;
  /** Indicates if embedding is ready for use */
  readonly isReady: boolean;
}

/**
 * Union type of all pipeline events.
 */
export type PipelineEvent =
  | VADPipelineEvent
  | TranscriptionPipelineEvent
  | TranslationPipelineEvent
  | SynthesisPipelineEvent
  | ErrorPipelineEvent
  | MetricsPipelineEvent
  | ProsodyPipelineEvent;

/**
 * Latency tracking for each pipeline stage.
 */
export interface LatencyMetrics {
  readonly vad: number;
  readonly asr: number;
  readonly translation: PerLanguageLatency;
  readonly synthesis: PerLanguageLatency;
  /** Total end-to-end latency from audio input to synthesis output */
  readonly total: number;
}

/**
 * Per-language latency tracking.
 */
export type PerLanguageLatency = Readonly<Record<TargetLanguage, number>>;

/**
 * Configuration for the translation pipeline.
 */
export interface PipelineConfig {
  /** Target languages to translate to. Default: all three */
  readonly targetLanguages: readonly TargetLanguage[];
  /** Whether to enable prosody matching via speaker embedding. Default: true */
  readonly enableProsodyMatching: boolean;
  /** Latency threshold in milliseconds. Default: 4000 */
  readonly latencyThresholdMs: number;
  /** Memory threshold in megabytes. Default: 10000 (10GB) */
  readonly memoryThresholdMB: number;
  /** Interval for metrics emission in milliseconds. Default: 5000 */
  readonly metricsIntervalMs: number;
  /** Sample rate for input audio. Default: 16000 */
  readonly sampleRate: number;
}

/**
 * Default pipeline configuration values.
 */
export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  targetLanguages: [...TARGET_LANGUAGES],
  enableProsodyMatching: true,
  latencyThresholdMs: 4000,
  memoryThresholdMB: 10000,
  metricsIntervalMs: 5000,
  sampleRate: 16000,
};

/**
 * Audio metadata for pipeline input.
 */
export interface PipelineAudioMetadata {
  readonly sampleRate: number;
  readonly channels: number;
}

/**
 * Options for creating a TranslationPipeline.
 */
export interface TranslationPipelineOptions {
  /** Session identifier */
  readonly sessionId?: string;
  /** Pipeline configuration overrides */
  readonly config?: Partial<PipelineConfig>;
  /** XTTS server URL for TTS. Default: http://localhost:8000 */
  readonly ttsServerUrl?: string;
  /** Cache directory for model weights */
  readonly cacheDir?: string;
}

/**
 * Result of translation to all languages.
 */
export interface AllLanguagesTranslationResult {
  readonly translations: ReadonlyMap<TargetLanguage, TranslationResult | Error>;
  readonly completedAt: number;
}

/**
 * Result of synthesis to all languages.
 */
export interface AllLanguagesSynthesisResult {
  readonly syntheses: ReadonlyMap<TargetLanguage, TTSResult | Error>;
  readonly completedAt: number;
}

/**
 * Segment metadata for tracking through the pipeline.
 */
export interface SegmentMetadata {
  readonly id: string;
  readonly startTime: number;
  readonly vadSegment: VADSegment;
  readonly audioSamples: Float32Array;
}

/**
 * Transcription metadata for tracking through the pipeline.
 */
export interface TranscriptionMetadata {
  readonly id: string;
  readonly segmentId: string;
  readonly startTime: number;
  readonly result: ASRResult;
}

/**
 * Check if a language is a valid target language.
 */
export function isTargetLanguage(lang: string): lang is TargetLanguage {
  return TARGET_LANGUAGES.includes(lang as TargetLanguage);
}

/**
 * Get timestamp in milliseconds.
 */
export function getTimestamp(): number {
  return Date.now();
}

/**
 * Generate a unique ID for tracking pipeline items.
 */
export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Type guard for checking if a value is an Error.
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

/**
 * Extract the speaker embedding type for external use.
 */
export type { SpeakerEmbedding };
