/**
 * A circular buffer for streaming audio data.
 * Optimized for continuous audio processing with minimal allocations.
 */
export class AudioBuffer {
  private readonly buffer: Float32Array;
  private writePosition: number = 0;
  private readPosition: number = 0;
  private availableSamples: number = 0;

  constructor(private readonly capacity: number) {
    if (capacity <= 0) {
      throw new Error('AudioBuffer capacity must be positive');
    }
    this.buffer = new Float32Array(capacity);
  }

  get size(): number {
    return this.availableSamples;
  }

  get maxCapacity(): number {
    return this.capacity;
  }

  get freeSpace(): number {
    return this.capacity - this.availableSamples;
  }

  /**
   * Writes audio samples to the buffer.
   * Returns the number of samples actually written (may be less if buffer is full).
   */
  write(samples: Float32Array): number {
    const samplesToWrite = Math.min(samples.length, this.freeSpace);

    if (samplesToWrite === 0) {
      return 0;
    }

    for (let i = 0; i < samplesToWrite; i++) {
      this.buffer[this.writePosition] = samples[i] ?? 0;
      this.writePosition = (this.writePosition + 1) % this.capacity;
    }

    this.availableSamples += samplesToWrite;
    return samplesToWrite;
  }

  /**
   * Reads up to `count` samples from the buffer.
   * Returns the samples read (may be fewer than requested if buffer is empty).
   */
  read(count: number): Float32Array {
    const samplesToRead = Math.min(count, this.availableSamples);

    if (samplesToRead === 0) {
      return new Float32Array(0);
    }

    const result = new Float32Array(samplesToRead);

    for (let i = 0; i < samplesToRead; i++) {
      result[i] = this.buffer[this.readPosition] ?? 0;
      this.readPosition = (this.readPosition + 1) % this.capacity;
    }

    this.availableSamples -= samplesToRead;
    return result;
  }

  /**
   * Peeks at samples without consuming them.
   * Returns up to `count` samples starting from the read position.
   */
  peek(count: number): Float32Array {
    const samplesToPeek = Math.min(count, this.availableSamples);

    if (samplesToPeek === 0) {
      return new Float32Array(0);
    }

    const result = new Float32Array(samplesToPeek);
    let position = this.readPosition;

    for (let i = 0; i < samplesToPeek; i++) {
      result[i] = this.buffer[position] ?? 0;
      position = (position + 1) % this.capacity;
    }

    return result;
  }

  /**
   * Discards up to `count` samples from the buffer.
   * Returns the number of samples actually discarded.
   */
  discard(count: number): number {
    const samplesToDiscard = Math.min(count, this.availableSamples);
    this.readPosition = (this.readPosition + samplesToDiscard) % this.capacity;
    this.availableSamples -= samplesToDiscard;
    return samplesToDiscard;
  }

  /**
   * Resets the buffer to empty state.
   */
  clear(): void {
    this.writePosition = 0;
    this.readPosition = 0;
    this.availableSamples = 0;
  }

  /**
   * Checks if at least `count` samples are available for reading.
   */
  hasAvailable(count: number): boolean {
    return this.availableSamples >= count;
  }
}
