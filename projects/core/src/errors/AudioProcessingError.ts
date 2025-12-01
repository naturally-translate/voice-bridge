/**
 * Error codes for audio processing errors.
 * Using unique string codes for programmatic identification.
 */
export const AudioProcessingErrorCode = {
  NOT_INITIALIZED: "AUDIO_001",
  EMPTY_BUFFER: "AUDIO_002",
  AUDIO_TOO_SHORT: "AUDIO_003",
  INVALID_SAMPLE_RATE: "AUDIO_004",
  TRANSCRIPTION_FAILED: "AUDIO_005",
  INVALID_CHANNEL_COUNT: "AUDIO_006",
} as const;

export type AudioProcessingErrorCodeType =
  (typeof AudioProcessingErrorCode)[keyof typeof AudioProcessingErrorCode];

/**
 * Base error class for audio processing errors.
 * Provides typed error codes for programmatic identification.
 */
export class AudioProcessingError extends Error {
  readonly code: AudioProcessingErrorCodeType;

  constructor(
    code: AudioProcessingErrorCodeType,
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.code = code;
    this.name = "AudioProcessingError";
  }
}

/**
 * Error thrown when a service is used before initialization.
 */
export class NotInitializedError extends AudioProcessingError {
  constructor(serviceName: string) {
    super(
      AudioProcessingErrorCode.NOT_INITIALIZED,
      `${serviceName} not initialized. Call initialize() first.`,
      { serviceName }
    );
    this.name = "NotInitializedError";
  }
}

/**
 * Error thrown when an empty audio buffer is provided.
 */
export class EmptyBufferError extends AudioProcessingError {
  constructor() {
    super(
      AudioProcessingErrorCode.EMPTY_BUFFER,
      "Empty audio buffer provided"
    );
    this.name = "EmptyBufferError";
  }
}

/**
 * Error thrown when audio duration is below minimum threshold.
 */
export class AudioTooShortError extends AudioProcessingError {
  constructor(
    public readonly durationSec: number,
    public readonly minimumSec: number
  ) {
    super(
      AudioProcessingErrorCode.AUDIO_TOO_SHORT,
      `Audio too short: ${durationSec.toFixed(3)}s (minimum ${minimumSec}s required)`,
      { durationSec, minimumSec }
    );
    this.name = "AudioTooShortError";
  }
}

/**
 * Error thrown when sample rate is invalid.
 */
export class InvalidSampleRateError extends AudioProcessingError {
  constructor(sampleRate: number) {
    super(
      AudioProcessingErrorCode.INVALID_SAMPLE_RATE,
      `Invalid sample rate: ${sampleRate}. Sample rates must be positive.`,
      { sampleRate }
    );
    this.name = "InvalidSampleRateError";
  }
}

/**
 * Error thrown when transcription fails.
 */
export class TranscriptionFailedError extends AudioProcessingError {
  constructor(reason: string) {
    super(
      AudioProcessingErrorCode.TRANSCRIPTION_FAILED,
      `Transcription failed: ${reason}`,
      { reason }
    );
    this.name = "TranscriptionFailedError";
  }
}

/**
 * Error thrown when channel count is invalid.
 */
export class InvalidChannelCountError extends AudioProcessingError {
  constructor(channels: number) {
    super(
      AudioProcessingErrorCode.INVALID_CHANNEL_COUNT,
      `Invalid channel count: ${channels}. Channel count must be at least 1.`,
      { channels }
    );
    this.name = "InvalidChannelCountError";
  }
}
