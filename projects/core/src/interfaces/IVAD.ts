export interface VADSegment {
  readonly start: number;
  readonly end: number;
  readonly confidence: number;
}

/**
 * Event emitted by VAD during streaming processing.
 */
export interface VADEvent {
  /** The detected speech segment */
  readonly segment: VADSegment;
  /**
   * True if this is a partial/in-progress segment (speech ongoing),
   * false if this is a finalized segment (speech ended by silence or flush).
   */
  readonly isPartial: boolean;
}

export interface VADOptions {
  readonly threshold?: number;
  readonly minSilenceDurationMs?: number;
  readonly minSpeechDurationMs?: number;
  readonly speechPadMs?: number;
}

/**
 * Audio metadata for VAD input validation and preprocessing.
 */
export interface VADAudioMetadata {
  /** Sample rate in Hz (e.g., 16000, 44100, 48000) */
  readonly sampleRate: number;
  /** Number of audio channels (1 = mono, 2 = stereo) */
  readonly channels: number;
}

export interface IVAD {
  initialize(): Promise<void>;

  /**
   * Processes a complete audio buffer and returns all detected segments.
   * Convenience method that internally uses push() + flush().
   *
   * @param audioData - Raw audio samples as Float32Array
   * @param metadata - Optional audio metadata for preprocessing
   * @returns All finalized speech segments
   */
  process(
    audioData: Float32Array,
    metadata?: Readonly<VADAudioMetadata>
  ): Promise<readonly VADSegment[]>;

  /**
   * Pushes audio chunk for streaming VAD processing.
   * Returns any segments that were finalized by silence detection.
   * Call flush() at end-of-stream to finalize any remaining speech.
   *
   * @param audioData - Audio chunk as Float32Array (should be mono 16kHz, or provide metadata)
   * @param metadata - Optional audio metadata for preprocessing
   * @returns Iterator yielding VADEvents (finalized segments and partial updates)
   */
  push(
    audioData: Float32Array,
    metadata?: Readonly<VADAudioMetadata>
  ): AsyncIterableIterator<VADEvent>;

  /**
   * Signals end of audio stream. Finalizes any in-progress speech segment
   * that would otherwise be dropped due to lack of trailing silence.
   *
   * @returns The final segment if speech was in progress, or null
   */
  flush(): Promise<VADEvent | null>;

  /**
   * Returns the current in-progress speech segment, if any.
   * Useful for getting real-time partial results during streaming.
   *
   * @returns Partial segment if speech is ongoing, or null
   */
  getCurrentSegment(): VADSegment | null;

  /**
   * Resets VAD state for processing a new audio stream.
   */
  reset(): void;

  dispose(): Promise<void>;
  readonly isReady: boolean;
}
