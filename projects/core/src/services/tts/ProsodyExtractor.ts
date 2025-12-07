/**
 * Manages speaker embedding extraction and accumulation for prosody-preserving TTS.
 *
 * The ProsodyExtractor accumulates VAD-filtered voiced audio until enough
 * is collected (3-6 seconds) to extract a stable speaker embedding. Once
 * locked, the embedding is reused for all subsequent TTS calls.
 */
import {
  InsufficientAudioError,
  EmbeddingExtractionError,
} from "../../errors/TTSError.js";
import type { SpeakerEmbedding, XTTSClient } from "./XTTSClient.js";

/**
 * Minimum voiced audio duration for embedding extraction (seconds).
 */
const MIN_EMBEDDING_DURATION_SECONDS = 3.0;

/**
 * Target voiced audio duration for optimal embedding quality (seconds).
 */
const TARGET_EMBEDDING_DURATION_SECONDS = 6.0;

/**
 * Maximum audio buffer duration before forcing extraction (seconds).
 */
const MAX_BUFFER_DURATION_SECONDS = 10.0;

/**
 * Default sample rate for audio accumulation.
 */
const DEFAULT_SAMPLE_RATE = 16000;

/**
 * State of the prosody extractor.
 */
export type ProsodyExtractorState =
  | "accumulating"
  | "extracting"
  | "locked"
  | "error";

/**
 * Configuration for ProsodyExtractor.
 */
export interface ProsodyExtractorOptions {
  /** XTTS client for embedding extraction. */
  readonly client: XTTSClient;
  /** Sample rate of incoming audio. Default: 16000 */
  readonly sampleRate?: number;
  /** Minimum duration required for extraction (seconds). Default: 3.0 */
  readonly minDurationSeconds?: number;
  /** Target duration for optimal quality (seconds). Default: 6.0 */
  readonly targetDurationSeconds?: number;
}

/**
 * Event emitted when embedding state changes.
 */
export interface ProsodyStateChangeEvent {
  readonly previousState: ProsodyExtractorState;
  readonly currentState: ProsodyExtractorState;
  readonly accumulatedDurationSeconds: number;
  readonly embedding?: SpeakerEmbedding | undefined;
}

/**
 * Listener for state change events.
 */
export type ProsodyStateChangeListener = (
  event: Readonly<ProsodyStateChangeEvent>
) => void;

/**
 * Manages speaker embedding extraction from accumulated voiced audio.
 *
 * Usage flow:
 * 1. Create extractor with XTTS client
 * 2. Feed VAD-filtered audio chunks via addAudio()
 * 3. Check isReady() or await getEmbedding()
 * 4. Use the embedding for TTS synthesis
 *
 * The extractor automatically triggers extraction when target duration
 * is reached, but can also be manually triggered via extractNow().
 */
export class ProsodyExtractor {
  private readonly client: XTTSClient;
  private readonly sampleRate: number;
  private readonly minDurationSeconds: number;
  private readonly targetDurationSeconds: number;

  private audioBuffer: Float32Array[] = [];
  private totalSamples = 0;
  private state: ProsodyExtractorState = "accumulating";
  private embedding: SpeakerEmbedding | null = null;
  private extractionPromise: Promise<SpeakerEmbedding> | null = null;
  private errorMessage: string | null = null;
  private listeners: Set<ProsodyStateChangeListener> = new Set();

  constructor(options: Readonly<ProsodyExtractorOptions>) {
    this.client = options.client;
    this.sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.minDurationSeconds =
      options.minDurationSeconds ?? MIN_EMBEDDING_DURATION_SECONDS;
    this.targetDurationSeconds =
      options.targetDurationSeconds ?? TARGET_EMBEDDING_DURATION_SECONDS;
  }

  /**
   * Current state of the extractor.
   */
  get currentState(): ProsodyExtractorState {
    return this.state;
  }

  /**
   * Whether the embedding is ready for use.
   */
  get isReady(): boolean {
    return this.state === "locked" && this.embedding !== null;
  }

  /**
   * Duration of accumulated audio in seconds.
   */
  get accumulatedDurationSeconds(): number {
    return this.totalSamples / this.sampleRate;
  }

  /**
   * Whether enough audio has been accumulated for extraction.
   */
  get hasMinimumAudio(): boolean {
    return this.accumulatedDurationSeconds >= this.minDurationSeconds;
  }

  /**
   * Progress towards target duration (0.0 to 1.0).
   */
  get progress(): number {
    return Math.min(
      1.0,
      this.accumulatedDurationSeconds / this.targetDurationSeconds
    );
  }

  /**
   * Add VAD-filtered voiced audio to the accumulation buffer.
   *
   * @param audio - Float32Array of audio samples (should be VAD-filtered)
   * @returns true if extraction was triggered
   */
  addAudio(audio: Float32Array): boolean {
    if (this.state === "locked") {
      // Already have embedding, ignore new audio
      return false;
    }

    if (this.state === "extracting") {
      // Currently extracting, buffer the audio but don't trigger again
      this.audioBuffer.push(audio);
      this.totalSamples += audio.length;
      return false;
    }

    if (this.state === "error") {
      // Reset error state and try again
      this.setState("accumulating");
      this.errorMessage = null;
    }

    // Add audio to buffer
    this.audioBuffer.push(audio);
    this.totalSamples += audio.length;

    // Check if we've reached target duration
    const duration = this.accumulatedDurationSeconds;
    if (duration >= this.targetDurationSeconds) {
      void this.triggerExtraction();
      return true;
    }

    // Check if we've exceeded max buffer (force extraction)
    if (duration >= MAX_BUFFER_DURATION_SECONDS) {
      void this.triggerExtraction();
      return true;
    }

    return false;
  }

  /**
   * Manually trigger embedding extraction.
   *
   * @throws {InsufficientAudioError} If not enough audio has been accumulated
   * @returns Promise resolving to the extracted embedding
   */
  async extractNow(): Promise<SpeakerEmbedding> {
    if (this.state === "locked" && this.embedding) {
      return this.embedding;
    }

    if (this.state === "extracting" && this.extractionPromise) {
      return this.extractionPromise;
    }

    if (!this.hasMinimumAudio) {
      throw new InsufficientAudioError(
        this.accumulatedDurationSeconds,
        this.minDurationSeconds
      );
    }

    return this.triggerExtraction();
  }

  /**
   * Get the current embedding, waiting if extraction is in progress.
   *
   * @returns The speaker embedding if available, null if not ready
   */
  async getEmbedding(): Promise<SpeakerEmbedding | null> {
    if (this.embedding) {
      return this.embedding;
    }

    if (this.extractionPromise) {
      try {
        return await this.extractionPromise;
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Get the embedding synchronously if available.
   *
   * @returns The speaker embedding if locked, null otherwise
   */
  getEmbeddingSync(): SpeakerEmbedding | null {
    return this.embedding;
  }

  /**
   * Add a listener for state changes.
   */
  addStateChangeListener(listener: ProsodyStateChangeListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove a state change listener.
   */
  removeStateChangeListener(listener: ProsodyStateChangeListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Reset the extractor to initial state.
   * Clears accumulated audio and embedding.
   */
  reset(): void {
    const previousState = this.state;
    this.audioBuffer = [];
    this.totalSamples = 0;
    this.embedding = null;
    this.extractionPromise = null;
    this.errorMessage = null;
    this.state = "accumulating";

    if (previousState !== "accumulating") {
      this.notifyStateChange(previousState);
    }
  }

  /**
   * Get error message if in error state.
   */
  getErrorMessage(): string | null {
    return this.errorMessage;
  }

  /**
   * Trigger embedding extraction from accumulated audio.
   */
  private async triggerExtraction(): Promise<SpeakerEmbedding> {
    if (this.extractionPromise) {
      return this.extractionPromise;
    }

    const previousState = this.state;
    this.setState("extracting");
    this.notifyStateChange(previousState);

    this.extractionPromise = this.performExtraction();

    try {
      const embedding = await this.extractionPromise;
      this.embedding = embedding;
      // Clear audio buffer after successful extraction - no longer needed
      this.audioBuffer = [];
      this.totalSamples = 0;
      const preLockedState = this.state;
      this.setState("locked");
      this.notifyStateChange(preLockedState);
      return embedding;
    } catch (error) {
      const preErrorState = this.state;
      this.setState("error");
      this.errorMessage =
        error instanceof Error ? error.message : String(error);
      this.extractionPromise = null;
      this.notifyStateChange(preErrorState);
      throw error;
    }
  }

  /**
   * Perform the actual embedding extraction.
   */
  private async performExtraction(): Promise<SpeakerEmbedding> {
    // Merge all audio buffers into a single array
    const mergedAudio = this.mergeAudioBuffers();

    try {
      const embedding = await this.client.extractEmbedding({
        audio: mergedAudio,
        sampleRate: this.sampleRate,
      });

      return embedding;
    } catch (error) {
      throw new EmbeddingExtractionError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Merge all audio buffers into a single Float32Array.
   */
  private mergeAudioBuffers(): Float32Array {
    const merged = new Float32Array(this.totalSamples);
    let offset = 0;

    for (const buffer of this.audioBuffer) {
      merged.set(buffer, offset);
      offset += buffer.length;
    }

    return merged;
  }

  /**
   * Set state and update internal tracking.
   */
  private setState(newState: ProsodyExtractorState): void {
    this.state = newState;
  }

  /**
   * Notify all listeners of a state change.
   */
  private notifyStateChange(previousState: ProsodyExtractorState): void {
    const event: ProsodyStateChangeEvent = {
      previousState,
      currentState: this.state,
      accumulatedDurationSeconds: this.accumulatedDurationSeconds,
      embedding: this.embedding ?? undefined,
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors are silently caught to prevent one listener
        // from breaking others. Callers should handle their own errors.
      }
    }
  }
}

/**
 * Create a new ProsodyExtractor instance.
 */
export function createProsodyExtractor(
  options: Readonly<ProsodyExtractorOptions>
): ProsodyExtractor {
  return new ProsodyExtractor(options);
}
