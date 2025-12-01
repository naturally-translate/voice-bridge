export interface ASRWord {
  readonly word: string;
  readonly start: number;
  readonly end: number;
  readonly confidence?: number;
}

export interface ASRResult {
  readonly text: string;
  readonly language: string;
  readonly confidence?: number;
  readonly words?: readonly ASRWord[];
  /** True for intermediate results, false/undefined for final result */
  readonly isPartial?: boolean;
}

/**
 * Audio metadata for input validation and preprocessing.
 * When provided, ASR implementations should auto-preprocess to required format.
 * When omitted, implementations may attempt auto-detection or assume 16kHz mono.
 */
export interface AudioMetadata {
  /** Sample rate in Hz (e.g., 44100, 48000) */
  readonly sampleRate: number;
  /** Number of audio channels (1 = mono, 2 = stereo) */
  readonly channels: number;
}

export interface ASROptions {
  readonly language?: string;
  readonly timestamps?: boolean;
  readonly task?: 'transcribe' | 'translate';
  /** Audio metadata for preprocessing. If omitted, auto-detection is attempted. */
  readonly audioMetadata?: AudioMetadata;
}

export interface IASR {
  initialize(): Promise<void>;
  /**
   * Transcribes audio data, returning an async iterator that yields partial
   * results followed by a final result.
   *
   * @param audioData - Raw audio samples as Float32Array (normalized -1.0 to 1.0)
   * @param options - Transcription options including audio metadata
   * @returns AsyncIterableIterator yielding ASRResult objects (partials then final)
   */
  transcribe(
    audioData: Float32Array,
    options?: Readonly<ASROptions>
  ): AsyncIterableIterator<ASRResult>;
  /**
   * Transcribes audio and returns only the final result (convenience method).
   * Consumes all partial results internally.
   *
   * @param audioData - Raw audio samples as Float32Array (normalized -1.0 to 1.0)
   * @param options - Transcription options including audio metadata
   * @returns Promise resolving to the final ASRResult
   */
  transcribeFinal(
    audioData: Float32Array,
    options?: Readonly<ASROptions>
  ): Promise<ASRResult>;
  dispose(): Promise<void>;
  readonly isReady: boolean;
}
