/**
 * Error codes for TTS errors.
 * Using unique string codes for programmatic identification.
 */
export const TTSErrorCode = {
  NOT_INITIALIZED: "TTS_001",
  SYNTHESIS_FAILED: "TTS_002",
  UNSUPPORTED_LANGUAGE: "TTS_003",
  WORKER_ERROR: "TTS_004",
  QUEUE_FULL: "TTS_005",
  TIMEOUT: "TTS_006",
  CANCELLED: "TTS_007",
  SERVER_UNAVAILABLE: "TTS_008",
  EMBEDDING_EXTRACTION_FAILED: "TTS_009",
  INSUFFICIENT_AUDIO: "TTS_010",
  NETWORK_ERROR: "TTS_011",
} as const;

export type TTSErrorCodeType = (typeof TTSErrorCode)[keyof typeof TTSErrorCode];

/**
 * Base error class for TTS errors.
 * Provides typed error codes for programmatic identification.
 */
export class TTSError extends Error {
  readonly code: TTSErrorCodeType;

  constructor(
    code: TTSErrorCodeType,
    message: string,
    public readonly context?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.code = code;
    this.name = "TTSError";
  }
}

/**
 * Error thrown when a TTS service is used before initialization.
 */
export class TTSNotInitializedError extends TTSError {
  constructor(serviceName: string) {
    super(
      TTSErrorCode.NOT_INITIALIZED,
      `${serviceName} not initialized. Call initialize() first.`,
      { serviceName }
    );
    this.name = "TTSNotInitializedError";
  }
}

/**
 * Error thrown when speech synthesis fails.
 */
export class SynthesisFailedError extends TTSError {
  constructor(reason: string, text?: string) {
    super(TTSErrorCode.SYNTHESIS_FAILED, `Speech synthesis failed: ${reason}`, {
      reason,
      text,
    });
    this.name = "SynthesisFailedError";
  }
}

/**
 * Error thrown when an unsupported language is requested.
 */
export class UnsupportedTTSLanguageError extends TTSError {
  constructor(
    public readonly language: string,
    public readonly supportedLanguages: readonly string[]
  ) {
    super(
      TTSErrorCode.UNSUPPORTED_LANGUAGE,
      `Unsupported TTS language: ${language}. Supported languages: ${supportedLanguages.join(", ")}`,
      { language, supportedLanguages }
    );
    this.name = "UnsupportedTTSLanguageError";
  }
}

/**
 * Error thrown when a TTS worker thread fails.
 */
export class TTSWorkerError extends TTSError {
  constructor(reason: string, targetLanguage?: string) {
    super(TTSErrorCode.WORKER_ERROR, `TTS worker error: ${reason}`, {
      reason,
      targetLanguage,
    });
    this.name = "TTSWorkerError";
  }
}

/**
 * Error thrown when the TTS queue is full.
 */
export class TTSQueueFullError extends TTSError {
  constructor(targetLanguage: string, queueSize: number) {
    super(
      TTSErrorCode.QUEUE_FULL,
      `TTS queue full for ${targetLanguage} (size: ${queueSize})`,
      { targetLanguage, queueSize }
    );
    this.name = "TTSQueueFullError";
  }
}

/**
 * Error thrown when a TTS operation times out.
 */
export class TTSTimeoutError extends TTSError {
  constructor(targetLanguage: string, timeoutMs: number) {
    super(
      TTSErrorCode.TIMEOUT,
      `TTS for ${targetLanguage} timed out after ${timeoutMs}ms`,
      { targetLanguage, timeoutMs }
    );
    this.name = "TTSTimeoutError";
  }
}

/**
 * Error thrown when a TTS operation is cancelled.
 */
export class TTSCancelledError extends TTSError {
  constructor(targetLanguage: string) {
    super(
      TTSErrorCode.CANCELLED,
      `TTS for ${targetLanguage} was cancelled`,
      { targetLanguage }
    );
    this.name = "TTSCancelledError";
  }
}

/**
 * Error thrown when the XTTS server is unavailable.
 */
export class XTTSServerUnavailableError extends TTSError {
  constructor(serverUrl: string, reason?: string) {
    super(
      TTSErrorCode.SERVER_UNAVAILABLE,
      `XTTS server unavailable at ${serverUrl}${reason ? `: ${reason}` : ""}`,
      { serverUrl, reason }
    );
    this.name = "XTTSServerUnavailableError";
  }
}

/**
 * Error thrown when speaker embedding extraction fails.
 */
export class EmbeddingExtractionError extends TTSError {
  constructor(reason: string) {
    super(
      TTSErrorCode.EMBEDDING_EXTRACTION_FAILED,
      `Speaker embedding extraction failed: ${reason}`,
      { reason }
    );
    this.name = "EmbeddingExtractionError";
  }
}

/**
 * Error thrown when there is insufficient audio for embedding extraction.
 */
export class InsufficientAudioError extends TTSError {
  constructor(
    public readonly durationSeconds: number,
    public readonly requiredSeconds: number
  ) {
    super(
      TTSErrorCode.INSUFFICIENT_AUDIO,
      `Insufficient audio for embedding: ${durationSeconds.toFixed(1)}s provided, ${requiredSeconds}s required`,
      { durationSeconds, requiredSeconds }
    );
    this.name = "InsufficientAudioError";
  }
}

/**
 * Error thrown for network-related failures.
 */
export class TTSNetworkError extends TTSError {
  constructor(operation: string, cause?: string) {
    super(
      TTSErrorCode.NETWORK_ERROR,
      `Network error during ${operation}${cause ? `: ${cause}` : ""}`,
      { operation, cause }
    );
    this.name = "TTSNetworkError";
  }
}
