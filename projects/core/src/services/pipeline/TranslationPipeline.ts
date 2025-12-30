/**
 * Translation Pipeline - Main Orchestrator
 *
 * Orchestrates VAD -> ASR -> Translation -> TTS with fire-and-forget
 * language isolation. One language failure does not block others.
 */

import type { VADEvent, VADSegment, VADAudioMetadata } from "../../interfaces/IVAD.js";
import type { ASRResult } from "../../interfaces/IASR.js";
import type { TranslationResult } from "../../interfaces/ITranslator.js";
import type { TTSResult } from "../../interfaces/ITTS.js";

import { SileroVAD, type SileroVADOptions } from "../vad/SileroVAD.js";
import { DistilWhisperASR, type DistilWhisperASROptions } from "../asr/DistilWhisperASR.js";
import {
  TranslationWorkerPool,
  type TranslationWorkerPoolOptions,
} from "../translation/worker-pool.js";
import {
  TTSWorkerPool,
  type TTSWorkerPoolOptions,
  type TTSRequestOptions,
} from "../tts/worker-pool.js";
import { XTTSClient, createXTTSClient } from "../tts/XTTSClient.js";
import type { IModelManager } from "../../interfaces/IModelManager.js";

import {
  PipelineContext,
  createPipelineContext,
  type PipelineContextOptions,
} from "./PipelineContext.js";
import {
  type PipelineMetrics,
  type MetricsSnapshot,
  type ThresholdViolation,
} from "./PipelineMetrics.js";
import {
  type PipelineEvent,
  type TargetLanguage,
  type PipelineConfig,
  type TranslationPipelineOptions,
  type PipelineAudioMetadata,
  type VADPipelineEvent,
  type TranscriptionPipelineEvent,
  type TranslationPipelineEvent,
  type SynthesisPipelineEvent,
  type ErrorPipelineEvent,
  type MetricsPipelineEvent,
  type ProsodyPipelineEvent,
  DEFAULT_PIPELINE_CONFIG,
  TARGET_LANGUAGES,
  generateId,
  getTimestamp,
} from "./PipelineTypes.js";
import {
  PipelineNotInitializedError,
  PipelineShutdownError,
  StageFailedError,
} from "../../errors/PipelineError.js";
import { stereoToMono } from "../../audio/index.js";
import { AsyncQueue } from "./AsyncQueue.js";
import { ChunkedAudioBuffer } from "./ChunkedAudioBuffer.js";

/**
 * Pipeline state enumeration.
 */
type PipelineState = "created" | "initializing" | "ready" | "processing" | "shutdown";

/**
 * Listener for metrics events emitted by the pipeline.
 */
export type MetricsEventListener = (event: MetricsPipelineEvent) => void;

/**
 * Threshold alert event emitted when metrics exceed configured limits.
 */
export interface ThresholdAlertEvent {
  readonly type: "threshold_alert";
  readonly timestamp: number;
  readonly violations: readonly ThresholdViolation[];
  readonly snapshot: MetricsSnapshot;
}

/**
 * Listener for threshold alert events.
 */
export type ThresholdAlertListener = (event: ThresholdAlertEvent) => void;

/**
 * Dependencies for the pipeline.
 */
interface PipelineDependencies {
  readonly vad: SileroVAD;
  readonly asr: DistilWhisperASR;
  readonly translationPool: TranslationWorkerPool;
  readonly ttsPool: TTSWorkerPool;
  readonly xttsClient: XTTSClient;
}


/**
 * Options for initializing the pipeline with external dependencies.
 * Useful for testing with mocks.
 */
export interface PipelineInitOptions {
  /** Model manager for VAD model loading */
  readonly modelManager: IModelManager;
  /** Override VAD options */
  readonly vadOptions?: Partial<SileroVADOptions>;
  /** Override ASR options */
  readonly asrOptions?: Partial<DistilWhisperASROptions>;
  /** Override translation pool options */
  readonly translationPoolOptions?: Partial<TranslationWorkerPoolOptions>;
  /** Override TTS pool options */
  readonly ttsPoolOptions?: Partial<TTSWorkerPoolOptions>;
}

/**
 * Main translation pipeline orchestrator.
 *
 * Processes audio through VAD -> ASR -> Translation -> TTS stages.
 * Uses fire-and-forget pattern for per-language isolation.
 * Emits events at each stage for UI/API consumption.
 *
 * Usage:
 * ```typescript
 * const pipeline = createTranslationPipeline({ sessionId: "user-123" });
 * await pipeline.initialize({ modelManager });
 *
 * for await (const event of pipeline.processAudio(audioChunk)) {
 *   console.log(event.type, event);
 * }
 *
 * await pipeline.shutdown();
 * ```
 */
export class TranslationPipeline {
  private readonly options: TranslationPipelineOptions;
  private readonly config: PipelineConfig;

  private state: PipelineState = "created";
  private context: PipelineContext | null = null;
  private deps: PipelineDependencies | null = null;
  private metricsIntervalId: ReturnType<typeof setInterval> | null = null;
  private processingAbortController: AbortController | null = null;

  /**
   * Cumulative audio buffer for extracting VAD segments.
   * VAD segments use absolute timestamps from stream start,
   * so we must accumulate all audio to slice correctly.
   * Uses chunked storage for O(1) append and supports eviction.
   */
  private audioBuffer = new ChunkedAudioBuffer({ sampleRate: 16000 });

  /** Listeners for periodic metrics events */
  private readonly metricsListeners: Set<MetricsEventListener> = new Set();

  /** Listeners for threshold alert events */
  private readonly thresholdAlertListeners: Set<ThresholdAlertListener> = new Set();

  /** Throughput tracking: segments processed in current interval */
  private segmentsProcessedInInterval = 0;

  /** Throughput tracking: translations completed in current interval */
  private translationsCompletedInInterval = 0;

  /** Throughput tracking: syntheses completed in current interval */
  private synthesesCompletedInInterval = 0;

  /** Track previous threshold violation state for edge detection */
  private previouslyViolatingThresholds = false;

  constructor(options?: Readonly<TranslationPipelineOptions>) {
    this.options = options ?? {};
    this.config = {
      ...DEFAULT_PIPELINE_CONFIG,
      ...options?.config,
    };
  }

  /**
   * Current pipeline state.
   */
  get currentState(): PipelineState {
    return this.state;
  }

  /**
   * Check if the pipeline is ready for processing.
   */
  get isReady(): boolean {
    return this.state === "ready" || this.state === "processing";
  }

  /**
   * Get the pipeline context.
   */
  getContext(): PipelineContext {
    if (!this.context) {
      throw new PipelineNotInitializedError();
    }
    return this.context;
  }

  /**
   * Get the metrics collector.
   */
  getMetrics(): PipelineMetrics {
    return this.getContext().getMetrics();
  }

  /**
   * Register a listener for periodic metrics events.
   * Metrics are emitted at the configured interval (default: 5000ms).
   */
  addMetricsListener(listener: MetricsEventListener): void {
    this.metricsListeners.add(listener);
  }

  /**
   * Remove a metrics event listener.
   */
  removeMetricsListener(listener: MetricsEventListener): void {
    this.metricsListeners.delete(listener);
  }

  /**
   * Register a listener for threshold alert events.
   * Alerts are emitted when metrics exceed configured thresholds.
   */
  addThresholdAlertListener(listener: ThresholdAlertListener): void {
    this.thresholdAlertListeners.add(listener);
  }

  /**
   * Remove a threshold alert listener.
   */
  removeThresholdAlertListener(listener: ThresholdAlertListener): void {
    this.thresholdAlertListeners.delete(listener);
  }

  /**
   * Initialize the pipeline with required dependencies.
   */
  async initialize(options: Readonly<PipelineInitOptions>): Promise<void> {
    if (this.state === "shutdown") {
      throw new PipelineShutdownError();
    }

    if (this.state !== "created") {
      return; // Already initialized or initializing
    }

    this.state = "initializing";

    try {
      // Create XTTS client first for prosody extraction
      const xttsClient = createXTTSClient({
        serverUrl: this.options.ttsServerUrl ?? "http://localhost:8000",
      });

      // Create context with XTTS client for prosody
      const contextOptions: PipelineContextOptions = {
        sessionId: this.options.sessionId,
        config: this.config,
        xttsClient,
      };
      this.context = createPipelineContext(contextOptions);

      // Create VAD
      const vad = new SileroVAD({
        modelManager: options.modelManager,
        vadOptions: options.vadOptions?.vadOptions,
      });

      // Create ASR
      const asr = new DistilWhisperASR({
        cacheDir: this.options.cacheDir,
        ...options.asrOptions,
      });

      // Create Translation Worker Pool
      const translationPool = new TranslationWorkerPool({
        cacheDir: this.options.cacheDir,
        ...options.translationPoolOptions,
      });

      // Create TTS Worker Pool
      const ttsPool = new TTSWorkerPool({
        serverUrl: this.options.ttsServerUrl ?? "http://localhost:8000",
        ...options.ttsPoolOptions,
      });

      // Initialize all components in parallel
      await Promise.all([
        vad.initialize(),
        asr.initialize(),
        translationPool.initialize(),
        ttsPool.initialize(),
      ]);

      this.deps = {
        vad,
        asr,
        translationPool,
        ttsPool,
        xttsClient,
      };

      // Start the context
      this.context.start();

      // Start metrics interval
      this.startMetricsInterval();

      this.state = "ready";
    } catch (error) {
      this.state = "created"; // Reset to allow retry
      throw new StageFailedError(
        "vad", // First stage
        "Pipeline initialization failed",
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Process audio through the full pipeline.
   * Yields events at each stage.
   *
   * @param audio - Audio samples (Float32Array, normalized -1.0 to 1.0)
   * @param metadata - Optional audio metadata (sample rate, channels)
   * @yields Pipeline events for each stage
   */
  async *processAudio(
    audio: Float32Array,
    metadata?: Readonly<PipelineAudioMetadata>
  ): AsyncIterableIterator<PipelineEvent> {
    this.ensureReady();

    const context = this.context!;
    const deps = this.deps!;
    const metrics = context.getMetrics();

    // Start new operation tracking
    metrics.startOperation();
    this.state = "processing";

    // Create abort controller for this processing session
    this.processingAbortController = new AbortController();

    // Accumulate audio for segment extraction
    // VAD segments have absolute timestamps from stream start
    // Audio is converted to mono here to match VAD's internal preprocessing
    const chunkSampleRate = metadata?.sampleRate ?? this.config.sampleRate;
    const chunkChannels = metadata?.channels ?? 1;
    this.accumulateAudio(audio, chunkSampleRate, chunkChannels);

    try {
      // Stage 1: VAD
      metrics.startVAD();
      const vadMetadata: VADAudioMetadata | undefined = metadata
        ? { sampleRate: metadata.sampleRate, channels: metadata.channels }
        : undefined;

      for await (const vadEvent of deps.vad.push(audio, vadMetadata)) {
        metrics.endVAD();

        // Add voiced audio for prosody extraction
        if (!vadEvent.isPartial) {
          const segmentAudio = this.extractSegmentAudio(vadEvent.segment);
          context.addVoicedAudio(segmentAudio);

          // Emit prosody update if state changed
          const prosodyEvent = this.createProsodyEvent(context);
          if (prosodyEvent) {
            yield prosodyEvent;
          }
        }

        // Emit VAD event
        const vadPipelineEvent = this.createVADEvent(vadEvent);
        yield vadPipelineEvent;

        // Only process final segments
        if (vadEvent.isPartial) {
          metrics.startVAD(); // Continue VAD timing
          continue;
        }

        // Store segment metadata
        const segmentId = generateId("seg");
        const segmentAudio = this.extractSegmentAudio(vadEvent.segment);
        context.storeSegment({
          id: segmentId,
          startTime: getTimestamp(),
          vadSegment: vadEvent.segment,
          audioSamples: segmentAudio,
        });

        // Track segment for throughput metrics
        this.incrementSegmentCount();

        // Stage 2: ASR - pass audio metadata for proper resampling
        yield* this.processASR(
          segmentId,
          segmentAudio,
          deps,
          metrics,
          context,
          { sampleRate: this.audioBuffer.sampleRate, channels: 1 }
        );

        // Evict processed audio to bound memory usage
        // Audio before segment end is no longer needed
        this.evictProcessedAudio(vadEvent.segment);
      }

      // Finalize operation
      metrics.finalizeOperation();
      this.state = "ready";
    } catch (error) {
      this.state = "ready";
      yield this.createErrorEvent(
        "vad",
        error instanceof Error ? error : new Error(String(error)),
        undefined,
        false
      );
    } finally {
      this.processingAbortController = null;
    }
  }

  /**
   * Flush any remaining audio through the pipeline.
   * Call at end of audio stream.
   *
   * @yields Pipeline events for final VAD segment, prosody, and metrics
   */
  async *flush(): AsyncIterableIterator<PipelineEvent> {
    this.ensureReady();

    const deps = this.deps!;
    const context = this.context!;
    const metrics = context.getMetrics();

    // Flush VAD
    const finalEvent = await deps.vad.flush();
    if (finalEvent && !finalEvent.isPartial) {
      const vadPipelineEvent: VADPipelineEvent = {
        type: "vad",
        timestamp: getTimestamp(),
        segment: finalEvent.segment,
        isPartial: false,
      };
      yield vadPipelineEvent;

      // Get the segment that was stored
      const segmentId = generateId("seg-flush");

      // For flush, we don't have the original audio, so use empty
      // In practice, the caller should have processed all audio before flush
      context.storeSegment({
        id: segmentId,
        startTime: getTimestamp(),
        vadSegment: finalEvent.segment,
        audioSamples: new Float32Array(0),
      });
    }

    // Extract embedding if we have enough audio
    await context.extractEmbeddingNow();
    const prosodyEvent = this.createProsodyEvent(context);
    if (prosodyEvent) {
      yield prosodyEvent;
    }

    // Emit final metrics
    yield metrics.createMetricsEvent();
  }

  /**
   * Shut down the pipeline and release resources.
   */
  async shutdown(): Promise<void> {
    if (this.state === "shutdown") {
      return;
    }

    // Stop metrics interval
    this.stopMetricsInterval();

    // Cancel any in-progress processing
    if (this.processingAbortController) {
      this.processingAbortController.abort();
      this.processingAbortController = null;
    }

    // Shut down dependencies
    if (this.deps) {
      await Promise.all([
        this.deps.vad.dispose(),
        this.deps.asr.dispose(),
        this.deps.translationPool.shutdown(),
        this.deps.ttsPool.shutdown(),
      ]);
      this.deps = null;
    }

    // Complete context
    if (this.context) {
      this.context.complete();
    }

    this.state = "shutdown";
  }

  /**
   * Reset the pipeline for a new session.
   */
  reset(): void {
    this.ensureReady();

    this.deps!.vad.reset();
    this.context!.reset();
    this.context!.start();

    // Reset audio buffer for new session
    this.audioBuffer.reset();
  }

  /**
   * Process ASR and subsequent stages.
   *
   * @yields Transcription, translation, and synthesis events
   */
  private async *processASR(
    segmentId: string,
    audio: Float32Array,
    deps: PipelineDependencies,
    metrics: PipelineMetrics,
    context: PipelineContext,
    audioMetadata: { sampleRate: number; channels: number }
  ): AsyncIterableIterator<PipelineEvent> {
    metrics.startASR();

    try {
      // Transcribe audio with metadata for proper resampling
      let finalTranscription: ASRResult | null = null;

      for await (const asrResult of deps.asr.transcribe(audio, { audioMetadata })) {
        const transcriptionEvent = this.createTranscriptionEvent(
          segmentId,
          asrResult
        );
        yield transcriptionEvent;

        if (!asrResult.isPartial) {
          finalTranscription = asrResult;
        }
      }

      metrics.endASR();

      // Process final transcription through translation and TTS
      if (finalTranscription && finalTranscription.text.trim()) {
        const transcriptionId = generateId("trans");
        context.storeTranscription({
          id: transcriptionId,
          segmentId,
          startTime: getTimestamp(),
          result: finalTranscription,
        });

        // Fire-and-forget translation and TTS for all active languages
        yield* this.processTranslationAndTTS(
          transcriptionId,
          finalTranscription.text,
          deps,
          metrics,
          context
        );
      }
    } catch (error) {
      metrics.endASR();
      yield this.createErrorEvent(
        "asr",
        error instanceof Error ? error : new Error(String(error)),
        undefined,
        true
      );
    }
  }

  /**
   * Process translation and TTS for all active languages.
   * Uses fire-and-forget pattern - one language failure doesn't block others.
   * Both translation and TTS run in parallel across all languages.
   * Events are streamed as each language completes (not batched).
   *
   * @yields Translation and synthesis events for each language as they complete
   */
  private async *processTranslationAndTTS(
    transcriptionId: string,
    text: string,
    deps: PipelineDependencies,
    metrics: PipelineMetrics,
    context: PipelineContext
  ): AsyncIterableIterator<PipelineEvent> {
    const activeLanguages = context.getActiveLanguages();

    // Use async queue for true streaming - events yield as each language completes
    const eventQueue = new AsyncQueue<PipelineEvent>();
    let pendingLanguages = activeLanguages.length;

    // Handle edge case: no active languages
    if (pendingLanguages === 0) {
      return;
    }

    // Process each language in parallel, pushing events as they complete
    for (const lang of activeLanguages) {
      this.processLanguageTranslationAndTTS(
        lang,
        transcriptionId,
        text,
        deps,
        metrics,
        context
      )
        .then((events) => {
          // Push all events for this language immediately
          eventQueue.pushAll(events);
        })
        .catch((error) => {
          // Unexpected error - emit error event
          eventQueue.push(
            this.createErrorEvent(
              "translation",
              error instanceof Error ? error : new Error(String(error)),
              lang,
              true
            )
          );
        })
        .finally(() => {
          // Close queue when all languages complete
          pendingLanguages--;
          if (pendingLanguages === 0) {
            eventQueue.close();
          }
        });
    }

    // Yield events as they arrive from any language
    yield* eventQueue;
  }

  /**
   * Process translation and TTS for a single language.
   * Returns all events for this language (translation + TTS or errors).
   */
  private async processLanguageTranslationAndTTS(
    lang: TargetLanguage,
    transcriptionId: string,
    text: string,
    deps: PipelineDependencies,
    metrics: PipelineMetrics,
    context: PipelineContext
  ): Promise<PipelineEvent[]> {
    const events: PipelineEvent[] = [];

    try {
      // Translation
      const translationResult = await this.translateWithMetrics(
        text,
        lang,
        deps,
        metrics
      );

      // Generate translation ID for event correlation
      const translationId = generateId("translation");

      // Emit translation event with ID
      const translationEvent = this.createTranslationEvent(
        translationId,
        transcriptionId,
        lang,
        translationResult
      );
      events.push(translationEvent);

      // Track translation for throughput metrics
      this.incrementTranslationCount();

      // TTS (only if translation succeeded) - use same translationId for correlation
      try {
        const ttsEvents = await this.processTTSAsync(
          translationId,
          lang,
          translationResult.text,
          deps,
          metrics,
          context
        );
        events.push(...ttsEvents);
      } catch (ttsError) {
        // TTS failed but translation succeeded - emit TTS error
        events.push(
          this.createErrorEvent(
            "synthesis",
            ttsError instanceof Error ? ttsError : new Error(String(ttsError)),
            lang,
            true
          )
        );
      }
    } catch (translationError) {
      // Translation failed - emit error and skip TTS
      events.push(
        this.createErrorEvent(
          "translation",
          translationError instanceof Error
            ? translationError
            : new Error(String(translationError)),
          lang,
          true
        )
      );
    }

    return events;
  }

  /**
   * Process TTS for a single language (async version for parallel processing).
   * Returns events instead of yielding for use in Promise.allSettled.
   */
  private async processTTSAsync(
    translationId: string,
    language: TargetLanguage,
    text: string,
    deps: PipelineDependencies,
    metrics: PipelineMetrics,
    context: PipelineContext
  ): Promise<PipelineEvent[]> {
    const events: PipelineEvent[] = [];
    metrics.startSynthesis(language);

    try {
      // Build TTS options with speaker embedding if available
      const ttsOptions: TTSRequestOptions = {};
      const embedding = context.speakerEmbedding;
      if (embedding && this.config.enableProsodyMatching) {
        (ttsOptions as { embedding: typeof embedding }).embedding = embedding;
        (ttsOptions as { fallbackToNeutral: boolean }).fallbackToNeutral = true;
      }

      const ttsResult = await deps.ttsPool.synthesize(text, language, ttsOptions);

      metrics.endSynthesis(language, true);

      events.push(this.createSynthesisEvent(translationId, language, ttsResult));

      // Track synthesis for throughput metrics
      this.incrementSynthesisCount();
    } catch (error) {
      metrics.endSynthesis(language, false);
      throw error; // Re-throw to be caught by caller
    }

    return events;
  }


  /**
   * Translate text with metrics tracking.
   */
  private async translateWithMetrics(
    text: string,
    language: TargetLanguage,
    deps: PipelineDependencies,
    metrics: PipelineMetrics
  ): Promise<TranslationResult> {
    metrics.startTranslation(language);

    try {
      const result = await deps.translationPool.translate(text, language);
      metrics.endTranslation(language, true);
      return result;
    } catch (error) {
      metrics.endTranslation(language, false);
      throw error;
    }
  }

  /**
   * Accumulate audio into the buffer for segment extraction.
   * VAD segments have absolute timestamps, so we need the full audio stream.
   * Audio is converted to mono to match VAD's internal preprocessing,
   * ensuring segment timestamps align correctly with buffer indices.
   */
  private accumulateAudio(audio: Float32Array, sampleRate: number, channels: number): void {
    // Update sample rate if this is the first chunk (buffer must be empty to change rate)
    if (this.audioBuffer.isEmpty) {
      this.audioBuffer.sampleRate = sampleRate;
    }

    // Convert to mono if multi-channel to match VAD's preprocessing
    // This ensures segment timestamps align with buffer sample indices
    const monoAudio = channels > 1 ? stereoToMono(audio, channels) : audio;

    // Append to chunked buffer - O(1) operation
    this.audioBuffer.append(monoAudio);
  }

  /**
   * Extract audio samples for a VAD segment from the accumulated buffer.
   * Segments have absolute timestamps from stream start.
   */
  private extractSegmentAudio(segment: VADSegment): Float32Array {
    return this.audioBuffer.extractRange(segment.start, segment.end);
  }

  /**
   * Evict audio samples that are no longer needed.
   * Called after a segment has been fully processed.
   */
  private evictProcessedAudio(segment: VADSegment): void {
    // Evict audio before the segment end, as it's no longer needed
    // Keep a small buffer for any edge cases with partial segments
    this.audioBuffer.evictBefore(segment.end);
  }

  /**
   * Create a VAD pipeline event.
   */
  private createVADEvent(vadEvent: VADEvent): VADPipelineEvent {
    const segmentAudio = this.extractSegmentAudio(vadEvent.segment);

    const event: VADPipelineEvent = {
      type: "vad",
      timestamp: getTimestamp(),
      segment: vadEvent.segment,
      isPartial: vadEvent.isPartial,
    };

    // Only include audio if we have samples (exactOptionalPropertyTypes compliance)
    if (segmentAudio.length > 0) {
      return { ...event, audio: segmentAudio };
    }

    return event;
  }

  /**
   * Create a transcription pipeline event.
   */
  private createTranscriptionEvent(
    segmentId: string,
    result: ASRResult
  ): TranscriptionPipelineEvent {
    return {
      type: "transcription",
      timestamp: getTimestamp(),
      result,
      isPartial: result.isPartial ?? false,
      segmentId,
    };
  }

  /**
   * Create a translation pipeline event.
   */
  private createTranslationEvent(
    id: string,
    transcriptionId: string,
    language: TargetLanguage,
    result: TranslationResult
  ): TranslationPipelineEvent {
    return {
      type: "translation",
      timestamp: getTimestamp(),
      id,
      targetLanguage: language,
      result,
      isPartial: result.isPartial,
      transcriptionId,
    };
  }

  /**
   * Create a synthesis pipeline event.
   */
  private createSynthesisEvent(
    translationId: string,
    language: TargetLanguage,
    result: TTSResult
  ): SynthesisPipelineEvent {
    return {
      type: "synthesis",
      timestamp: getTimestamp(),
      targetLanguage: language,
      result,
      translationId,
    };
  }

  /**
   * Create an error pipeline event.
   */
  private createErrorEvent(
    stage: "vad" | "asr" | "translation" | "synthesis",
    error: Error,
    language: TargetLanguage | undefined,
    recoverable: boolean
  ): ErrorPipelineEvent {
    const event: ErrorPipelineEvent = {
      type: "error",
      timestamp: getTimestamp(),
      stage,
      error,
      recoverable,
    };

    if (language !== undefined) {
      (event as { targetLanguage: TargetLanguage }).targetLanguage = language;
    }

    return event;
  }

  /**
   * Create a prosody pipeline event if state is meaningful.
   */
  private createProsodyEvent(context: PipelineContext): ProsodyPipelineEvent | null {
    // Only emit if prosody is enabled
    if (!this.config.enableProsodyMatching) {
      return null;
    }

    return {
      type: "prosody",
      timestamp: getTimestamp(),
      state: context.isProsodyReady
        ? "locked"
        : context.prosodyProgress > 0
        ? "accumulating"
        : "accumulating",
      progress: context.prosodyProgress,
      isReady: context.isProsodyReady,
    };
  }

  /**
   * Start the metrics emission interval.
   * Emits periodic metrics events and checks for threshold violations.
   */
  private startMetricsInterval(): void {
    if (this.config.metricsIntervalMs <= 0) {
      return;
    }

    this.metricsIntervalId = setInterval(() => {
      this.emitPeriodicMetrics();
    }, this.config.metricsIntervalMs);
  }

  /**
   * Emit periodic metrics to all registered listeners.
   * Also checks for threshold violations and emits alerts.
   */
  private emitPeriodicMetrics(): void {
    if (!this.context) {
      return;
    }

    const metrics = this.context.getMetrics();
    const snapshot = metrics.getSnapshot();

    // Create and emit metrics event
    const metricsEvent = this.createPeriodicMetricsEvent(snapshot);
    this.notifyMetricsListeners(metricsEvent);

    // Check for threshold violations and emit alerts
    if (snapshot.thresholdViolation) {
      this.handleThresholdViolations(snapshot);
    } else if (this.previouslyViolatingThresholds) {
      // Thresholds recovered - could emit recovery event if needed
      this.previouslyViolatingThresholds = false;
    }

    // Reset throughput counters for next interval
    this.resetIntervalCounters();
  }

  /**
   * Create a metrics event with throughput information.
   */
  private createPeriodicMetricsEvent(snapshot: MetricsSnapshot): MetricsPipelineEvent {
    // Calculate throughput rates (per second)
    const intervalSeconds = this.config.metricsIntervalMs / 1000;
    const segmentThroughput = this.segmentsProcessedInInterval / intervalSeconds;
    const translationThroughput = this.translationsCompletedInInterval / intervalSeconds;
    const synthesisThroughput = this.synthesesCompletedInInterval / intervalSeconds;

    // Get error rates per language
    const errorRates = this.calculateErrorRates(snapshot);

    // Create base metrics event
    const event: MetricsPipelineEvent = {
      type: "metrics",
      timestamp: snapshot.timestamp,
      latencyMs: snapshot.latency,
      memoryMB: snapshot.memoryMB,
      languageStatus: snapshot.languageStatus,
      thresholdViolation: snapshot.thresholdViolation,
    };

    // Extend with throughput data (using type assertion for extended properties)
    const extendedEvent = event as MetricsPipelineEvent & {
      throughput: {
        segmentsPerSecond: number;
        translationsPerSecond: number;
        synthesesPerSecond: number;
      };
      errorRates: ReadonlyMap<TargetLanguage, number>;
      audioBufferSizeBytes: number;
    };

    extendedEvent.throughput = {
      segmentsPerSecond: segmentThroughput,
      translationsPerSecond: translationThroughput,
      synthesesPerSecond: synthesisThroughput,
    };
    extendedEvent.errorRates = errorRates;
    extendedEvent.audioBufferSizeBytes = this.audioBuffer.byteLength;

    return extendedEvent;
  }

  /**
   * Calculate error rates per language from the snapshot.
   */
  private calculateErrorRates(snapshot: MetricsSnapshot): ReadonlyMap<TargetLanguage, number> {
    const errorRates = new Map<TargetLanguage, number>();

    for (const lang of TARGET_LANGUAGES) {
      const status = snapshot.languageStatus.get(lang);
      if (status) {
        const total = status.successCount + status.errorCount;
        const rate = total > 0 ? status.errorCount / total : 0;
        errorRates.set(lang, rate);
      }
    }

    return errorRates;
  }

  /**
   * Handle threshold violations by emitting alert events.
   */
  private handleThresholdViolations(snapshot: MetricsSnapshot): void {
    // Only emit alert on transition to violation state (edge detection)
    // or if we have listeners and are currently violating
    if (this.thresholdAlertListeners.size === 0) {
      this.previouslyViolatingThresholds = true;
      return;
    }

    const alertEvent: ThresholdAlertEvent = {
      type: "threshold_alert",
      timestamp: getTimestamp(),
      violations: snapshot.violations,
      snapshot,
    };

    this.notifyThresholdAlertListeners(alertEvent);
    this.previouslyViolatingThresholds = true;
  }

  /**
   * Notify all metrics listeners of an event.
   */
  private notifyMetricsListeners(event: MetricsPipelineEvent): void {
    for (const listener of this.metricsListeners) {
      try {
        listener(event);
      } catch {
        // Silently ignore listener errors to prevent one bad listener
        // from breaking metrics emission for others
      }
    }
  }

  /**
   * Notify all threshold alert listeners of an event.
   */
  private notifyThresholdAlertListeners(event: ThresholdAlertEvent): void {
    for (const listener of this.thresholdAlertListeners) {
      try {
        listener(event);
      } catch {
        // Silently ignore listener errors
      }
    }
  }

  /**
   * Reset interval throughput counters.
   */
  private resetIntervalCounters(): void {
    this.segmentsProcessedInInterval = 0;
    this.translationsCompletedInInterval = 0;
    this.synthesesCompletedInInterval = 0;
  }

  /**
   * Increment segment processed counter for throughput tracking.
   */
  private incrementSegmentCount(): void {
    this.segmentsProcessedInInterval++;
  }

  /**
   * Increment translation completed counter for throughput tracking.
   */
  private incrementTranslationCount(): void {
    this.translationsCompletedInInterval++;
  }

  /**
   * Increment synthesis completed counter for throughput tracking.
   */
  private incrementSynthesisCount(): void {
    this.synthesesCompletedInInterval++;
  }

  /**
   * Stop the metrics emission interval.
   */
  private stopMetricsInterval(): void {
    if (this.metricsIntervalId) {
      clearInterval(this.metricsIntervalId);
      this.metricsIntervalId = null;
    }
  }

  /**
   * Ensure the pipeline is ready for operations.
   */
  private ensureReady(): void {
    if (this.state === "shutdown") {
      throw new PipelineShutdownError();
    }
    if (this.state !== "ready" && this.state !== "processing") {
      throw new PipelineNotInitializedError();
    }
  }
}

/**
 * Create a new TranslationPipeline instance.
 */
export function createTranslationPipeline(
  options?: Readonly<TranslationPipelineOptions>
): TranslationPipeline {
  return new TranslationPipeline(options);
}
