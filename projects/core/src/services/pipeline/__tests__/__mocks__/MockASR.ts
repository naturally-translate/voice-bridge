/**
 * Mock ASR for unit testing the pipeline.
 * Provides deterministic transcription without real model.
 */

import type {
  IASR,
  ASROptions,
  ASRResult,
} from "../../../../interfaces/IASR.js";

/**
 * Options for MockASR.
 */
export interface MockASROptions {
  /** Simulated latency in ms. Default: 0 */
  readonly latencyMs?: number;
  /** Custom transcription result */
  readonly customTranscription?: string;
  /** Whether to fail on transcription */
  readonly shouldFail?: boolean;
  /** Failure message */
  readonly failureMessage?: string;
}

/**
 * Mock ASR that returns predictable transcriptions for testing.
 */
export class MockASR implements IASR {
  private initialized = false;
  private readonly latencyMs: number;
  private readonly customTranscription: string;
  private readonly shouldFail: boolean;
  private readonly failureMessage: string;

  constructor(options?: Readonly<MockASROptions>) {
    this.latencyMs = options?.latencyMs ?? 0;
    this.customTranscription = options?.customTranscription ?? "Hello, how are you today?";
    this.shouldFail = options?.shouldFail ?? false;
    this.failureMessage = options?.failureMessage ?? "Mock ASR failure";
  }

  get isReady(): boolean {
    return this.initialized;
  }

  async initialize(): Promise<void> {
    if (this.latencyMs > 0) {
      await this.delay(this.latencyMs);
    }
    this.initialized = true;
  }

  async *transcribe(
    _audioData: Float32Array,
    options?: Readonly<ASROptions>
  ): AsyncIterableIterator<ASRResult> {
    if (!this.initialized) {
      throw new Error("MockASR not initialized");
    }

    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    if (this.latencyMs > 0) {
      await this.delay(this.latencyMs);
    }

    const language = options?.language ?? "en";

    // Emit partial result first
    yield {
      text: this.customTranscription.split(" ").slice(0, 2).join(" "),
      language,
      isPartial: true,
    };

    if (this.latencyMs > 0) {
      await this.delay(this.latencyMs);
    }

    // Emit final result
    yield {
      text: this.customTranscription,
      language,
      isPartial: false,
    };
  }

  async transcribeFinal(
    audioData: Float32Array,
    options?: Readonly<ASROptions>
  ): Promise<ASRResult> {
    let finalResult: ASRResult | null = null;

    for await (const result of this.transcribe(audioData, options)) {
      finalResult = result;
    }

    if (!finalResult) {
      throw new Error("No transcription result produced");
    }

    return finalResult;
  }

  async dispose(): Promise<void> {
    this.initialized = false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createMockASR(options?: Readonly<MockASROptions>): MockASR {
  return new MockASR(options);
}
