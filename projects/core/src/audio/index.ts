/**
 * Audio processing utilities for the voice-bridge pipeline.
 *
 * Provides resampling, format conversion, and buffering for
 * preprocessing audio before VAD and ASR.
 */

// Resampling utilities
export {
  resampleLinear,
  resampleForASR,
  resampleForVAD,
  StreamingResampler,
  ASR_SAMPLE_RATE,
  VAD_SAMPLE_RATE,
  type ResampleOptions,
} from "./AudioResampler.js";

// Format conversion utilities
export {
  int16ToFloat32,
  float32ToInt16,
  stereoToMono,
  parseWavHeader,
  decodeWav,
  encodeWav,
  type WavHeader,
} from "./AudioConverter.js";

// Circular buffer for streaming
export { AudioBuffer } from "./AudioBuffer.js";

import { stereoToMono } from "./AudioConverter.js";
import { resampleForASR, ASR_SAMPLE_RATE } from "./AudioResampler.js";

/**
 * Preprocesses raw audio for ASR/VAD consumption.
 *
 * Performs the following transformations:
 * 1. Converts to mono (if stereo)
 * 2. Resamples to 16kHz (if different sample rate)
 *
 * @param samples - Input audio samples (Float32Array, normalized -1 to 1)
 * @param sampleRate - Input sample rate in Hz
 * @param channels - Number of input channels (1 = mono, 2 = stereo)
 * @returns Preprocessed mono 16kHz audio
 */
export function preprocessForASR(
  samples: Float32Array,
  sampleRate: number,
  channels: number
): Float32Array {
  let processed = samples;

  // Convert to mono if stereo
  if (channels > 1) {
    processed = stereoToMono(processed, channels);
  }

  // Resample to 16kHz if needed
  if (sampleRate !== ASR_SAMPLE_RATE) {
    processed = resampleForASR(processed, sampleRate);
  }

  return processed;
}
