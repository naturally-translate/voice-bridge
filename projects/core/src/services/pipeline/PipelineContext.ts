/**
 * Pipeline context for managing session state.
 * Holds configuration, speaker embedding, active languages, and shared state.
 */

import {
  type TargetLanguage,
  type PipelineConfig,
  type SegmentMetadata,
  type TranscriptionMetadata,
  type SpeakerEmbedding,
  type ProsodyPipelineEvent,
  DEFAULT_PIPELINE_CONFIG,
  generateId,
  getTimestamp,
} from "./PipelineTypes.js";
import {
  PipelineMetrics,
  createPipelineMetrics,
} from "./PipelineMetrics.js";
import {
  ProsodyExtractor,
  type ProsodyStateChangeEvent,
} from "../tts/ProsodyExtractor.js";
import type { XTTSClient } from "../tts/XTTSClient.js";

/**
 * Configuration for PipelineContext.
 */
export interface PipelineContextOptions {
  /** Session identifier. Auto-generated if not provided. */
  readonly sessionId?: string;
  /** Pipeline configuration */
  readonly config?: Partial<PipelineConfig>;
  /** XTTS client for prosody extraction */
  readonly xttsClient?: XTTSClient;
}

/**
 * Session state enumeration.
 */
export type SessionState = "created" | "active" | "paused" | "completed" | "error";

/**
 * Listener for prosody state changes.
 */
export type ProsodyEventListener = (event: ProsodyPipelineEvent) => void;

/**
 * Manages session state for a translation pipeline.
 *
 * Responsibilities:
 * - Session configuration
 * - Speaker embedding via ProsodyExtractor
 * - Active language tracking
 * - Segment and transcription metadata
 * - Metrics collection
 */
export class PipelineContext {
  readonly sessionId: string;
  readonly config: PipelineConfig;
  private readonly metrics: PipelineMetrics;
  private readonly prosodyExtractor: ProsodyExtractor | null;

  private state: SessionState = "created";
  private readonly activeLanguages: Set<TargetLanguage>;
  private readonly segmentMap: Map<string, SegmentMetadata> = new Map();
  private readonly transcriptionMap: Map<string, TranscriptionMetadata> = new Map();
  private readonly prosodyListeners: Set<ProsodyEventListener> = new Set();
  private createdAt: number;
  private updatedAt: number;

  constructor(options?: Readonly<PipelineContextOptions>) {
    this.sessionId = options?.sessionId ?? generateId("session");
    this.config = {
      ...DEFAULT_PIPELINE_CONFIG,
      ...options?.config,
    };
    this.createdAt = getTimestamp();
    this.updatedAt = this.createdAt;

    // Initialize metrics
    this.metrics = createPipelineMetrics({
      latencyThresholdMs: this.config.latencyThresholdMs,
      memoryThresholdMB: this.config.memoryThresholdMB,
    });

    // Initialize active languages from config
    this.activeLanguages = new Set(this.config.targetLanguages);

    // Initialize prosody extractor if XTTS client provided and prosody enabled
    if (options?.xttsClient && this.config.enableProsodyMatching) {
      this.prosodyExtractor = new ProsodyExtractor({
        client: options.xttsClient,
        sampleRate: this.config.sampleRate,
      });

      // Set up state change listener
      this.prosodyExtractor.addStateChangeListener(
        this.handleProsodyStateChange.bind(this)
      );
    } else {
      this.prosodyExtractor = null;
    }
  }

  /**
   * Current session state.
   */
  get currentState(): SessionState {
    return this.state;
  }

  /**
   * Check if the session is active.
   */
  get isActive(): boolean {
    return this.state === "active";
  }

  /**
   * Check if prosody matching is enabled and ready.
   */
  get isProsodyReady(): boolean {
    return this.prosodyExtractor?.isReady ?? false;
  }

  /**
   * Get the speaker embedding if available.
   */
  get speakerEmbedding(): SpeakerEmbedding | null {
    return this.prosodyExtractor?.getEmbeddingSync() ?? null;
  }

  /**
   * Get prosody extraction progress (0.0 to 1.0).
   */
  get prosodyProgress(): number {
    return this.prosodyExtractor?.progress ?? 0;
  }

  /**
   * Get the metrics collector.
   */
  getMetrics(): PipelineMetrics {
    return this.metrics;
  }

  /**
   * Start the session.
   */
  start(): void {
    if (this.state !== "created" && this.state !== "paused") {
      return;
    }
    this.state = "active";
    this.updatedAt = getTimestamp();
  }

  /**
   * Pause the session.
   */
  pause(): void {
    if (this.state !== "active") {
      return;
    }
    this.state = "paused";
    this.updatedAt = getTimestamp();
  }

  /**
   * Complete the session.
   */
  complete(): void {
    this.state = "completed";
    this.updatedAt = getTimestamp();
  }

  /**
   * Mark the session as errored.
   */
  setError(): void {
    this.state = "error";
    this.updatedAt = getTimestamp();
  }

  /**
   * Get active target languages.
   */
  getActiveLanguages(): readonly TargetLanguage[] {
    return [...this.activeLanguages];
  }

  /**
   * Check if a language is active.
   */
  isLanguageActive(language: TargetLanguage): boolean {
    return this.activeLanguages.has(language);
  }

  /**
   * Set a language as active or inactive.
   */
  setLanguageActive(language: TargetLanguage, active: boolean): void {
    if (active) {
      this.activeLanguages.add(language);
    } else {
      this.activeLanguages.delete(language);
    }
    this.metrics.setLanguageActive(language, active);
    this.updatedAt = getTimestamp();
  }

  /**
   * Add audio for prosody extraction.
   * Should be called with VAD-filtered voiced audio segments.
   *
   * @returns true if extraction was triggered
   */
  addVoicedAudio(audio: Float32Array): boolean {
    if (!this.prosodyExtractor) {
      return false;
    }
    return this.prosodyExtractor.addAudio(audio);
  }

  /**
   * Get the speaker embedding, waiting if extraction is in progress.
   */
  async getEmbedding(): Promise<SpeakerEmbedding | null> {
    if (!this.prosodyExtractor) {
      return null;
    }
    return this.prosodyExtractor.getEmbedding();
  }

  /**
   * Force extraction of speaker embedding if enough audio is accumulated.
   */
  async extractEmbeddingNow(): Promise<SpeakerEmbedding | null> {
    if (!this.prosodyExtractor) {
      return null;
    }

    if (!this.prosodyExtractor.hasMinimumAudio) {
      return null;
    }

    try {
      return await this.prosodyExtractor.extractNow();
    } catch {
      return null;
    }
  }

  /**
   * Store segment metadata.
   */
  storeSegment(segment: SegmentMetadata): void {
    this.segmentMap.set(segment.id, segment);
    this.updatedAt = getTimestamp();
  }

  /**
   * Retrieve segment metadata.
   */
  getSegment(segmentId: string): SegmentMetadata | undefined {
    return this.segmentMap.get(segmentId);
  }

  /**
   * Store transcription metadata.
   */
  storeTranscription(transcription: TranscriptionMetadata): void {
    this.transcriptionMap.set(transcription.id, transcription);
    this.updatedAt = getTimestamp();
  }

  /**
   * Retrieve transcription metadata.
   */
  getTranscription(transcriptionId: string): TranscriptionMetadata | undefined {
    return this.transcriptionMap.get(transcriptionId);
  }

  /**
   * Add a listener for prosody state changes.
   */
  addProsodyListener(listener: ProsodyEventListener): void {
    this.prosodyListeners.add(listener);
  }

  /**
   * Remove a prosody state change listener.
   */
  removeProsodyListener(listener: ProsodyEventListener): void {
    this.prosodyListeners.delete(listener);
  }

  /**
   * Clean up segment data older than the specified age.
   */
  cleanupOldSegments(maxAgeMs: number): void {
    const cutoff = getTimestamp() - maxAgeMs;

    for (const [id, segment] of this.segmentMap) {
      if (segment.startTime < cutoff) {
        this.segmentMap.delete(id);
      }
    }

    for (const [id, transcription] of this.transcriptionMap) {
      if (transcription.startTime < cutoff) {
        this.transcriptionMap.delete(id);
      }
    }
  }

  /**
   * Reset the context for a new session.
   */
  reset(): void {
    this.state = "created";
    this.segmentMap.clear();
    this.transcriptionMap.clear();
    this.metrics.reset();
    this.prosodyExtractor?.reset();

    // Re-enable all configured languages
    this.activeLanguages.clear();
    for (const lang of this.config.targetLanguages) {
      this.activeLanguages.add(lang);
    }

    const now = getTimestamp();
    this.createdAt = now;
    this.updatedAt = now;
  }

  /**
   * Get session info for debugging/logging.
   */
  getSessionInfo(): SessionInfo {
    return {
      sessionId: this.sessionId,
      state: this.state,
      activeLanguages: [...this.activeLanguages],
      prosodyState: this.prosodyExtractor?.currentState ?? "disabled",
      prosodyProgress: this.prosodyProgress,
      segmentCount: this.segmentMap.size,
      transcriptionCount: this.transcriptionMap.size,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Handle prosody state changes and notify listeners.
   */
  private handleProsodyStateChange(event: ProsodyStateChangeEvent): void {
    const pipelineEvent: ProsodyPipelineEvent = {
      type: "prosody",
      timestamp: getTimestamp(),
      state: event.currentState,
      progress: event.accumulatedDurationSeconds / 6.0, // Target is 6 seconds
      isReady: event.currentState === "locked" && event.embedding !== undefined,
    };

    for (const listener of this.prosodyListeners) {
      try {
        listener(pipelineEvent);
      } catch {
        // Silently ignore listener errors
      }
    }
  }
}

/**
 * Session info for debugging/logging.
 */
export interface SessionInfo {
  readonly sessionId: string;
  readonly state: SessionState;
  readonly activeLanguages: readonly TargetLanguage[];
  readonly prosodyState: "accumulating" | "extracting" | "locked" | "error" | "disabled";
  readonly prosodyProgress: number;
  readonly segmentCount: number;
  readonly transcriptionCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * Create a new PipelineContext instance.
 */
export function createPipelineContext(
  options?: Readonly<PipelineContextOptions>
): PipelineContext {
  return new PipelineContext(options);
}
