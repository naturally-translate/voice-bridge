/**
 * ChunkedAudioBuffer - Efficient audio accumulator with O(1) append and eviction.
 *
 * Stores audio in chunks to avoid O(n) copy on every append.
 * Supports eviction of old samples to bound memory usage.
 * Tracks an offset for absolute timestamp mapping after eviction.
 */

/**
 * Configuration for the chunked audio buffer.
 */
export interface ChunkedAudioBufferConfig {
  /** Sample rate in Hz */
  sampleRate: number;
  /** Minimum samples to keep after eviction (to handle edge cases) */
  minRetainSamples?: number;
  /**
   * Maximum samples to store in the buffer.
   * When exceeded, oldest samples are automatically evicted.
   * Default: 30 minutes at 48kHz (86,400,000 samples, ~330MB)
   */
  maxSamples?: number;
}

/**
 * An efficient audio buffer that stores samples in chunks.
 * - O(1) append (just push chunk to list)
 * - O(1) eviction (drop old chunks, update offset)
 * - Supports absolute timestamp mapping via offset tracking
 */
/**
 * Default maximum samples: 30 minutes at 48kHz (~330MB of Float32 data).
 */
const DEFAULT_MAX_SAMPLES = 48000 * 60 * 30;

export class ChunkedAudioBuffer {
  private chunks: Float32Array[] = [];
  private _sampleRate: number;
  private _totalSamples = 0;

  /**
   * Number of samples that have been evicted from the start.
   * Used to convert absolute timestamps to buffer-relative indices.
   */
  private _evictedSamples = 0;

  /** Minimum samples to retain after eviction */
  private readonly minRetainSamples: number;

  /** Maximum samples allowed in buffer before auto-eviction */
  private readonly maxSamples: number;

  constructor(config: ChunkedAudioBufferConfig) {
    this._sampleRate = config.sampleRate;
    this.minRetainSamples = config.minRetainSamples ?? 0;
    this.maxSamples = config.maxSamples ?? DEFAULT_MAX_SAMPLES;
  }

  /**
   * Append audio samples to the buffer. O(1) operation.
   * Automatically evicts oldest samples if max buffer size would be exceeded.
   */
  append(samples: Float32Array): void {
    if (samples.length === 0) return;

    // Store a copy to avoid external mutations
    const chunk = new Float32Array(samples.length);
    chunk.set(samples);

    this.chunks.push(chunk);
    this._totalSamples += chunk.length;

    // Auto-evict if we exceed max samples
    this.enforceMaxSize();
  }

  /**
   * Evict oldest samples if buffer exceeds maxSamples limit.
   * Called automatically after append.
   */
  private enforceMaxSize(): void {
    if (this._totalSamples <= this.maxSamples) return;

    const samplesToEvict = this._totalSamples - this.maxSamples;
    const targetAbsoluteSample = this._evictedSamples + samplesToEvict;
    this.evictBeforeSample(targetAbsoluteSample);
  }

  /**
   * Extract audio samples for a time range (absolute timestamps from stream start).
   * Returns empty array if range is outside buffer.
   */
  extractRange(startTime: number, endTime: number): Float32Array {
    const startSample = Math.floor(startTime * this._sampleRate);
    const endSample = Math.ceil(endTime * this._sampleRate);

    return this.extractSampleRange(startSample, endSample);
  }

  /**
   * Extract audio samples for an absolute sample range.
   * Accounts for evicted samples automatically.
   */
  extractSampleRange(absoluteStart: number, absoluteEnd: number): Float32Array {
    // Convert absolute indices to buffer-relative indices
    const relativeStart = absoluteStart - this._evictedSamples;
    const relativeEnd = absoluteEnd - this._evictedSamples;

    // Clamp to valid range
    const clampedStart = Math.max(0, relativeStart);
    const clampedEnd = Math.min(this._totalSamples, relativeEnd);

    if (clampedStart >= clampedEnd || clampedStart >= this._totalSamples) {
      return new Float32Array(0);
    }

    const length = clampedEnd - clampedStart;
    const result = new Float32Array(length);

    let resultOffset = 0;
    let currentSample = 0;

    for (const chunk of this.chunks) {
      const chunkEnd = currentSample + chunk.length;

      // Check if this chunk overlaps with our target range
      if (chunkEnd > clampedStart && currentSample < clampedEnd) {
        // Calculate overlap
        const copyStart = Math.max(0, clampedStart - currentSample);
        const copyEnd = Math.min(chunk.length, clampedEnd - currentSample);
        const copyLength = copyEnd - copyStart;

        if (copyLength > 0) {
          result.set(
            chunk.subarray(copyStart, copyEnd),
            resultOffset
          );
          resultOffset += copyLength;
        }
      }

      currentSample = chunkEnd;

      // Early exit if we've passed the target range
      if (currentSample >= clampedEnd) break;
    }

    return result;
  }

  /**
   * Evict samples before the given absolute timestamp.
   * Frees memory and updates offset for future extractions.
   */
  evictBefore(timestamp: number): void {
    const absoluteSample = Math.floor(timestamp * this._sampleRate);
    this.evictBeforeSample(absoluteSample);
  }

  /**
   * Evict samples before the given absolute sample index.
   */
  evictBeforeSample(absoluteSample: number): void {
    // Convert to relative index
    const relativeSample = absoluteSample - this._evictedSamples;

    // Respect minimum retain count
    const maxEvict = Math.max(0, this._totalSamples - this.minRetainSamples);
    const targetEvict = Math.min(relativeSample, maxEvict);

    if (targetEvict <= 0) return;

    let samplesEvicted = 0;

    // Remove complete chunks that fall before the eviction point
    while (this.chunks.length > 0) {
      const chunk = this.chunks[0];
      if (!chunk) break;

      if (samplesEvicted + chunk.length <= targetEvict) {
        // Entire chunk can be evicted
        this.chunks.shift();
        samplesEvicted += chunk.length;
        this._totalSamples -= chunk.length;
      } else if (samplesEvicted < targetEvict) {
        // Partial chunk eviction - split the chunk
        const evictFromChunk = targetEvict - samplesEvicted;
        const remaining = chunk.subarray(evictFromChunk);
        this.chunks[0] = new Float32Array(remaining.length);
        this.chunks[0].set(remaining);
        samplesEvicted += evictFromChunk;
        this._totalSamples -= evictFromChunk;
        break;
      } else {
        break;
      }
    }

    this._evictedSamples += samplesEvicted;
  }

  /**
   * Get the current sample rate.
   */
  get sampleRate(): number {
    return this._sampleRate;
  }

  /**
   * Set the sample rate (only valid when buffer is empty).
   */
  set sampleRate(rate: number) {
    if (this._totalSamples > 0) {
      throw new Error("Cannot change sample rate of non-empty buffer");
    }
    this._sampleRate = rate;
  }

  /**
   * Get total samples currently in buffer (not including evicted).
   */
  get totalSamples(): number {
    return this._totalSamples;
  }

  /**
   * Get total duration in seconds of buffered audio.
   */
  get duration(): number {
    return this._totalSamples / this._sampleRate;
  }

  /**
   * Get the absolute sample index of the buffer start (after eviction).
   */
  get startSampleIndex(): number {
    return this._evictedSamples;
  }

  /**
   * Get the absolute timestamp of the buffer start (after eviction).
   */
  get startTime(): number {
    return this._evictedSamples / this._sampleRate;
  }

  /**
   * Get the absolute sample index of the buffer end.
   */
  get endSampleIndex(): number {
    return this._evictedSamples + this._totalSamples;
  }

  /**
   * Get the absolute timestamp of the buffer end.
   */
  get endTime(): number {
    return this.endSampleIndex / this._sampleRate;
  }

  /**
   * Get the total byte size of the buffer (for memory tracking).
   */
  get byteLength(): number {
    return this._totalSamples * Float32Array.BYTES_PER_ELEMENT;
  }

  /**
   * Check if buffer is empty.
   */
  get isEmpty(): boolean {
    return this._totalSamples === 0;
  }

  /**
   * Reset the buffer to empty state.
   */
  reset(): void {
    this.chunks = [];
    this._totalSamples = 0;
    this._evictedSamples = 0;
  }
}
