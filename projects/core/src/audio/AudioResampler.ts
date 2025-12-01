/**
 * Audio resampling utilities.
 * Provides sample rate conversion for audio processing pipelines.
 */

export interface ResampleOptions {
  readonly inputSampleRate: number;
  readonly outputSampleRate: number;
}

/**
 * Resamples audio using linear interpolation.
 * Suitable for simple downsampling/upsampling needs.
 * For high-quality resampling, consider using ffmpeg via AudioProcessor.
 */
export function resampleLinear(
  samples: Float32Array,
  options: Readonly<ResampleOptions>
): Float32Array {
  const { inputSampleRate, outputSampleRate } = options;

  if (inputSampleRate === outputSampleRate) {
    return samples;
  }

  if (inputSampleRate <= 0 || outputSampleRate <= 0) {
    throw new Error('Sample rates must be positive');
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.floor(samples.length / ratio);
  const result = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcPosition = i * ratio;
    const srcIndex = Math.floor(srcPosition);
    const fraction = srcPosition - srcIndex;

    const sample0 = samples[srcIndex] ?? 0;
    const sample1 = samples[Math.min(srcIndex + 1, samples.length - 1)] ?? 0;

    result[i] = sample0 + fraction * (sample1 - sample0);
  }

  return result;
}

/**
 * Standard sample rate used for ASR models (Whisper, etc.)
 */
export const ASR_SAMPLE_RATE = 16000;

/**
 * Standard sample rate used for VAD models (Silero, etc.)
 */
export const VAD_SAMPLE_RATE = 16000;

/**
 * Resamples audio to the standard ASR sample rate (16kHz).
 */
export function resampleForASR(samples: Float32Array, inputSampleRate: number): Float32Array {
  return resampleLinear(samples, {
    inputSampleRate,
    outputSampleRate: ASR_SAMPLE_RATE,
  });
}

/**
 * Resamples audio to the standard VAD sample rate (16kHz).
 */
export function resampleForVAD(samples: Float32Array, inputSampleRate: number): Float32Array {
  return resampleLinear(samples, {
    inputSampleRate,
    outputSampleRate: VAD_SAMPLE_RATE,
  });
}

/**
 * Streaming audio resampler that maintains state across chunks.
 * Uses linear interpolation for real-time processing.
 */
export class StreamingResampler {
  private readonly ratio: number;
  private readonly outputSampleRate: number;
  private position: number = 0;
  private lastSample: number = 0;

  constructor(options: Readonly<ResampleOptions>) {
    const { inputSampleRate, outputSampleRate } = options;

    if (inputSampleRate <= 0 || outputSampleRate <= 0) {
      throw new Error('Sample rates must be positive');
    }

    this.ratio = inputSampleRate / outputSampleRate;
    this.outputSampleRate = outputSampleRate;
  }

  get sampleRate(): number {
    return this.outputSampleRate;
  }

  /**
   * Processes a chunk of audio samples.
   * Returns resampled output chunk.
   */
  process(samples: Float32Array): Float32Array {
    if (samples.length === 0) {
      return new Float32Array(0);
    }

    const outputSamples: number[] = [];
    let srcPosition = this.position;

    while (srcPosition < samples.length) {
      const srcIndex = Math.floor(srcPosition);
      const fraction = srcPosition - srcIndex;

      let sample0: number;
      if (srcIndex < 0) {
        sample0 = this.lastSample;
      } else {
        sample0 = samples[srcIndex] ?? 0;
      }

      const sample1 = samples[Math.min(srcIndex + 1, samples.length - 1)] ?? 0;
      outputSamples.push(sample0 + fraction * (sample1 - sample0));

      srcPosition += this.ratio;
    }

    // Update state for next chunk
    this.position = srcPosition - samples.length;
    this.lastSample = samples[samples.length - 1] ?? 0;

    return new Float32Array(outputSamples);
  }

  /**
   * Resets the resampler state.
   */
  reset(): void {
    this.position = 0;
    this.lastSample = 0;
  }
}
