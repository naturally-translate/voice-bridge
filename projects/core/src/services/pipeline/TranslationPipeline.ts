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
import { type PipelineMetrics } from "./PipelineMetrics.js";
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
  type ProsodyPipelineEvent,
  DEFAULT_PIPELINE_CONFIG,
  generateId,
  getTimestamp,
  isError,
} from "./PipelineTypes.js";
import {
  PipelineNotInitializedError,
  PipelineShutdownError,
  StageFailedError,
} from "../../errors/PipelineError.js";

/**
 * Pipeline state enumeration.
 */
type PipelineState = "created" | "initializing" | "ready" | "processing" | "shutdown";

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
          const segmentAudio = this.extractSegmentAudio(
            audio,
            vadEvent.segment,
            metadata?.sampleRate ?? this.config.sampleRate
          );
          context.addVoicedAudio(segmentAudio);

          // Emit prosody update if state changed
          const prosodyEvent = this.createProsodyEvent(context);
          if (prosodyEvent) {
            yield prosodyEvent;
          }
        }

        // Emit VAD event
        const vadPipelineEvent = this.createVADEvent(vadEvent, audio, metadata);
        yield vadPipelineEvent;

        // Only process final segments
        if (vadEvent.isPartial) {
          metrics.startVAD(); // Continue VAD timing
          continue;
        }

        // Store segment metadata
        const segmentId = generateId("seg");
        const segmentAudio = this.extractSegmentAudio(
          audio,
          vadEvent.segment,
          metadata?.sampleRate ?? this.config.sampleRate
        );
        context.storeSegment({
          id: segmentId,
          startTime: getTimestamp(),
          vadSegment: vadEvent.segment,
          audioSamples: segmentAudio,
        });

        // Stage 2: ASR
        yield* this.processASR(segmentId, segmentAudio, deps, metrics, context);
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
    context: PipelineContext
  ): AsyncIterableIterator<PipelineEvent> {
    metrics.startASR();

    try {
      // Transcribe audio
      let finalTranscription: ASRResult | null = null;

      for await (const asrResult of deps.asr.transcribe(audio)) {
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
   *
   * @yields Translation and synthesis events for each language
   */
  private async *processTranslationAndTTS(
    transcriptionId: string,
    text: string,
    deps: PipelineDependencies,
    metrics: PipelineMetrics,
    context: PipelineContext
  ): AsyncIterableIterator<PipelineEvent> {
    const activeLanguages = context.getActiveLanguages();

    // Fire off all translations in parallel
    const translationPromises = activeLanguages.map((lang) =>
      this.translateWithMetrics(text, lang, deps, metrics)
    );

    // Use allSettled for fire-and-forget behavior
    const translationResults = await Promise.allSettled(translationPromises);

    // Process results and emit events
    for (let i = 0; i < activeLanguages.length; i++) {
      const lang = activeLanguages[i]!;
      const result = translationResults[i]!;

      if (result.status === "fulfilled" && !isError(result.value)) {
        // Translation succeeded
        const translationEvent = this.createTranslationEvent(
          transcriptionId,
          lang,
          result.value
        );
        yield translationEvent;

        // Now do TTS for this language
        yield* this.processTTS(
          generateId("trans-result"),
          lang,
          result.value.text,
          deps,
          metrics,
          context
        );
      } else {
        // Translation failed
        const error =
          result.status === "rejected"
            ? result.reason
            : result.value;
        const errorEvent = this.createErrorEvent(
          "translation",
          error instanceof Error ? error : new Error(String(error)),
          lang,
          true
        );
        yield errorEvent;
      }
    }
  }

  /**
   * Process TTS for a single language.
   *
   * @yields Synthesis event or error event for the language
   */
  private async *processTTS(
    translationId: string,
    language: TargetLanguage,
    text: string,
    deps: PipelineDependencies,
    metrics: PipelineMetrics,
    context: PipelineContext
  ): AsyncIterableIterator<PipelineEvent> {
    metrics.startSynthesis(language);

    try {
      // Build TTS options with speaker embedding if available
      const ttsOptions: TTSRequestOptions = {};
      const embedding = context.speakerEmbedding;
      if (embedding && this.config.enableProsodyMatching) {
        (ttsOptions as { embedding: typeof embedding }).embedding = embedding;
        (ttsOptions as { fallbackToNeutral: boolean }).fallbackToNeutral = true;
      }

      const ttsResult = await deps.ttsPool.synthesize(
        text,
        language,
        ttsOptions
      );

      metrics.endSynthesis(language, true);

      const synthesisEvent = this.createSynthesisEvent(
        translationId,
        language,
        ttsResult
      );
      yield synthesisEvent;
    } catch (error) {
      metrics.endSynthesis(language, false);

      yield this.createErrorEvent(
        "synthesis",
        error instanceof Error ? error : new Error(String(error)),
        language,
        true
      );
    }
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
   * Extract audio samples for a VAD segment.
   */
  private extractSegmentAudio(
    audio: Float32Array,
    segment: VADSegment,
    sampleRate: number
  ): Float32Array {
    const startSample = Math.floor(segment.start * sampleRate);
    const endSample = Math.min(
      Math.ceil(segment.end * sampleRate),
      audio.length
    );

    if (startSample >= audio.length || endSample <= startSample) {
      return new Float32Array(0);
    }

    return audio.slice(startSample, endSample);
  }

  /**
   * Create a VAD pipeline event.
   */
  private createVADEvent(
    vadEvent: VADEvent,
    audio: Float32Array,
    metadata?: Readonly<PipelineAudioMetadata>
  ): VADPipelineEvent {
    const segmentAudio = this.extractSegmentAudio(
      audio,
      vadEvent.segment,
      metadata?.sampleRate ?? this.config.sampleRate
    );

    return {
      type: "vad",
      timestamp: getTimestamp(),
      segment: vadEvent.segment,
      isPartial: vadEvent.isPartial,
      audio: segmentAudio.length > 0 ? segmentAudio : undefined,
    };
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
    transcriptionId: string,
    language: TargetLanguage,
    result: TranslationResult
  ): TranslationPipelineEvent {
    return {
      type: "translation",
      timestamp: getTimestamp(),
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
   */
  private startMetricsInterval(): void {
    if (this.config.metricsIntervalMs <= 0) {
      return;
    }

    this.metricsIntervalId = setInterval(() => {
      // Metrics are emitted through the context
      // This interval just ensures regular updates
    }, this.config.metricsIntervalMs);
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
