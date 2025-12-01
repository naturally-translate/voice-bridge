/**
 * Audio preprocessing utilities for preparing audio for ASR and VAD models.
 * Centralizes common preprocessing operations: mono conversion and resampling.
 */

import { resampleLinear } from "./AudioResampler.js";
import { stereoToMono } from "./AudioConverter.js";
import {
  InvalidSampleRateError,
  InvalidChannelCountError,
} from "../errors/AudioProcessingError.js";

/**
 * Audio metadata describing the format of input samples.
 */
export interface AudioMetadata {
  readonly sampleRate: number;
  readonly channels: number;
}

/**
 * Result of audio preprocessing.
 */
export interface PreprocessedAudio {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

/**
 * Options for preprocessing audio.
 */
export interface PreprocessAudioOptions {
  /** Input audio samples */
  readonly audioData: Float32Array;
  /** Metadata about the input audio. If not provided, targetSampleRate and mono are assumed. */
  readonly metadata?: AudioMetadata | undefined;
  /** Target sample rate for output (e.g., 16000 for Whisper/Silero) */
  readonly targetSampleRate: number;
}

/**
 * Validates audio metadata values.
 *
 * @throws {InvalidSampleRateError} If sample rate is not positive
 * @throws {InvalidChannelCountError} If channel count is less than 1
 */
function validateMetadata(metadata: AudioMetadata): void {
  if (metadata.sampleRate <= 0) {
    throw new InvalidSampleRateError(metadata.sampleRate);
  }
  if (metadata.channels < 1) {
    throw new InvalidChannelCountError(metadata.channels);
  }
}

/**
 * Preprocesses audio to the format required by speech processing models.
 * Handles mono conversion and resampling in a single pass.
 *
 * @param options - Preprocessing options
 * @returns Preprocessed mono audio at the target sample rate
 *
 * @throws {InvalidSampleRateError} If sample rate is not positive
 * @throws {InvalidChannelCountError} If channel count is less than 1
 */
export function preprocessAudio(
  options: Readonly<PreprocessAudioOptions>
): PreprocessedAudio {
  const { audioData, metadata, targetSampleRate } = options;

  // Handle empty input
  if (audioData.length === 0) {
    return { samples: audioData, sampleRate: targetSampleRate };
  }

  // Use provided metadata or assume target format (16kHz mono)
  const effectiveMetadata: AudioMetadata = metadata ?? {
    sampleRate: targetSampleRate,
    channels: 1,
  };

  // Validate metadata
  validateMetadata(effectiveMetadata);

  let samples = audioData;

  // Convert to mono if stereo or multi-channel
  if (effectiveMetadata.channels > 1) {
    samples = stereoToMono(samples, effectiveMetadata.channels);
  }

  // Resample to target rate if needed
  if (effectiveMetadata.sampleRate !== targetSampleRate) {
    samples = resampleLinear(samples, {
      inputSampleRate: effectiveMetadata.sampleRate,
      outputSampleRate: targetSampleRate,
    });
  }

  return { samples, sampleRate: targetSampleRate };
}
