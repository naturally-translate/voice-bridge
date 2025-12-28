/**
 * Error codes for pipeline orchestration errors.
 * Using unique string codes for programmatic identification.
 */
export const PipelineErrorCode = {
  NOT_INITIALIZED: "PIPELINE_001",
  SHUTDOWN: "PIPELINE_002",
  LANGUAGE_PROCESSING: "PIPELINE_003",
  STAGE_FAILED: "PIPELINE_004",
  THRESHOLD_EXCEEDED: "PIPELINE_005",
  INVALID_INPUT: "PIPELINE_006",
} as const;

export type PipelineErrorCodeType =
  (typeof PipelineErrorCode)[keyof typeof PipelineErrorCode];

/**
 * Base error class for pipeline errors.
 * Provides typed error codes for programmatic identification.
 */
export class PipelineError extends Error {
  readonly code: PipelineErrorCodeType;

  constructor(
    code: PipelineErrorCodeType,
    message: string,
    public readonly context?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.code = code;
    this.name = "PipelineError";
  }
}

/**
 * Error thrown when a pipeline is used before initialization.
 */
export class PipelineNotInitializedError extends PipelineError {
  constructor(pipelineName = "TranslationPipeline") {
    super(
      PipelineErrorCode.NOT_INITIALIZED,
      `${pipelineName} not initialized. Call initialize() first.`,
      { pipelineName }
    );
    this.name = "PipelineNotInitializedError";
  }
}

/**
 * Error thrown when a pipeline operation is attempted after shutdown.
 */
export class PipelineShutdownError extends PipelineError {
  constructor(pipelineName = "TranslationPipeline") {
    super(
      PipelineErrorCode.SHUTDOWN,
      `${pipelineName} has been shut down. Create a new instance.`,
      { pipelineName }
    );
    this.name = "PipelineShutdownError";
  }
}

/**
 * Error thrown when processing fails for a specific language.
 * Used in fire-and-forget mode to report individual language failures
 * without blocking the overall pipeline.
 */
export class LanguageProcessingError extends PipelineError {
  constructor(
    public readonly targetLanguage: string,
    public readonly stage: "translation" | "synthesis",
    reason: string,
    cause?: Error
  ) {
    super(
      PipelineErrorCode.LANGUAGE_PROCESSING,
      `${stage} to ${targetLanguage} failed: ${reason}`,
      { targetLanguage, stage, reason, cause: cause?.message }
    );
    this.name = "LanguageProcessingError";
  }
}

/**
 * Error thrown when a pipeline stage fails.
 * Used for non-language-specific stage failures (VAD, ASR).
 */
export class StageFailedError extends PipelineError {
  constructor(
    public readonly stage: "vad" | "asr" | "translation" | "synthesis",
    reason: string,
    cause?: Error
  ) {
    super(
      PipelineErrorCode.STAGE_FAILED,
      `Pipeline stage '${stage}' failed: ${reason}`,
      { stage, reason, cause: cause?.message }
    );
    this.name = "StageFailedError";
  }
}

/**
 * Error thrown when a performance threshold is exceeded.
 */
export class ThresholdExceededError extends PipelineError {
  constructor(
    public readonly metric: "latency" | "memory",
    public readonly value: number,
    public readonly threshold: number,
    public readonly unit: string
  ) {
    super(
      PipelineErrorCode.THRESHOLD_EXCEEDED,
      `${metric} threshold exceeded: ${value}${unit} > ${threshold}${unit}`,
      { metric, value, threshold, unit }
    );
    this.name = "ThresholdExceededError";
  }
}

/**
 * Error thrown when invalid input is provided to the pipeline.
 */
export class InvalidInputError extends PipelineError {
  constructor(
    public readonly inputType: string,
    reason: string
  ) {
    super(
      PipelineErrorCode.INVALID_INPUT,
      `Invalid ${inputType}: ${reason}`,
      { inputType, reason }
    );
    this.name = "InvalidInputError";
  }
}
