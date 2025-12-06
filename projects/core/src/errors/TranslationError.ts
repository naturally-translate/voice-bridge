/**
 * Error codes for translation errors.
 * Using unique string codes for programmatic identification.
 */
export const TranslationErrorCode = {
  NOT_INITIALIZED: "TRANSLATION_001",
  TRANSLATION_FAILED: "TRANSLATION_002",
  UNSUPPORTED_LANGUAGE: "TRANSLATION_003",
  WORKER_ERROR: "TRANSLATION_004",
  QUEUE_FULL: "TRANSLATION_005",
  TIMEOUT: "TRANSLATION_006",
  CANCELLED: "TRANSLATION_007",
} as const;

export type TranslationErrorCodeType =
  (typeof TranslationErrorCode)[keyof typeof TranslationErrorCode];

/**
 * Base error class for translation errors.
 * Provides typed error codes for programmatic identification.
 */
export class TranslationError extends Error {
  readonly code: TranslationErrorCodeType;

  constructor(
    code: TranslationErrorCodeType,
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.code = code;
    this.name = "TranslationError";
  }
}

/**
 * Error thrown when a translator is used before initialization.
 */
export class TranslatorNotInitializedError extends TranslationError {
  constructor(serviceName: string) {
    super(
      TranslationErrorCode.NOT_INITIALIZED,
      `${serviceName} not initialized. Call initialize() first.`,
      { serviceName }
    );
    this.name = "TranslatorNotInitializedError";
  }
}

/**
 * Error thrown when translation fails.
 */
export class TranslationFailedError extends TranslationError {
  constructor(reason: string, sourceText?: string) {
    super(
      TranslationErrorCode.TRANSLATION_FAILED,
      `Translation failed: ${reason}`,
      { reason, sourceText }
    );
    this.name = "TranslationFailedError";
  }
}

/**
 * Error thrown when an unsupported language is requested.
 */
export class UnsupportedLanguageError extends TranslationError {
  constructor(
    public readonly language: string,
    public readonly supportedLanguages: readonly string[]
  ) {
    super(
      TranslationErrorCode.UNSUPPORTED_LANGUAGE,
      `Unsupported language: ${language}. Supported languages: ${supportedLanguages.join(", ")}`,
      { language, supportedLanguages }
    );
    this.name = "UnsupportedLanguageError";
  }
}

/**
 * Error thrown when a worker thread fails.
 */
export class WorkerError extends TranslationError {
  constructor(reason: string, targetLanguage?: string) {
    super(
      TranslationErrorCode.WORKER_ERROR,
      `Worker error: ${reason}`,
      { reason, targetLanguage }
    );
    this.name = "WorkerError";
  }
}

/**
 * Error thrown when the translation queue is full.
 */
export class QueueFullError extends TranslationError {
  constructor(targetLanguage: string, queueSize: number) {
    super(
      TranslationErrorCode.QUEUE_FULL,
      `Translation queue full for ${targetLanguage} (size: ${queueSize})`,
      { targetLanguage, queueSize }
    );
    this.name = "QueueFullError";
  }
}

/**
 * Error thrown when a translation times out.
 */
export class TranslationTimeoutError extends TranslationError {
  constructor(targetLanguage: string, timeoutMs: number) {
    super(
      TranslationErrorCode.TIMEOUT,
      `Translation to ${targetLanguage} timed out after ${timeoutMs}ms`,
      { targetLanguage, timeoutMs }
    );
    this.name = "TranslationTimeoutError";
  }
}

/**
 * Error thrown when a translation is cancelled.
 */
export class TranslationCancelledError extends TranslationError {
  constructor(targetLanguage: string) {
    super(
      TranslationErrorCode.CANCELLED,
      `Translation to ${targetLanguage} was cancelled`,
      { targetLanguage }
    );
    this.name = "TranslationCancelledError";
  }
}
