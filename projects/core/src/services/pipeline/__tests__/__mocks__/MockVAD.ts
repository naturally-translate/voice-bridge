/**
 * Mock VAD for unit testing the pipeline.
 * Provides deterministic speech detection without real model.
 */

import type {
  IVAD,
  VADSegment,
  VADEvent,
  VADAudioMetadata,
} from "../../../../interfaces/IVAD.js";

/**
 * Options for MockVAD.
 */
export interface MockVADOptions {
  /** Simulated latency in ms. Default: 0 */
  readonly latencyMs?: number;
  /** Whether to detect speech in all input. Default: true */
  readonly alwaysDetectSpeech?: boolean;
  /** Custom segments to return */
  readonly segments?: readonly VADSegment[];
}

/**
 * Mock VAD that returns predictable segments for testing.
 */
export class MockVAD implements IVAD {
  private initialized = false;
  private readonly latencyMs: number;
  private readonly alwaysDetectSpeech: boolean;
  private readonly customSegments: readonly VADSegment[];
  private currentSegmentIndex = 0;
  private accumulatedSamples = 0;
  private readonly sampleRate = 16000;

  constructor(options?: Readonly<MockVADOptions>) {
    this.latencyMs = options?.latencyMs ?? 0;
    this.alwaysDetectSpeech = options?.alwaysDetectSpeech ?? true;
    this.customSegments = options?.segments ?? [];
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

  async process(
    audioData: Float32Array,
    _metadata?: Readonly<VADAudioMetadata>
  ): Promise<readonly VADSegment[]> {
    if (!this.initialized) {
      throw new Error("MockVAD not initialized");
    }

    if (this.customSegments.length > 0) {
      return this.customSegments;
    }

    if (!this.alwaysDetectSpeech || audioData.length === 0) {
      return [];
    }

    // Generate a single segment for the entire audio
    const durationSec = audioData.length / this.sampleRate;
    return [
      {
        start: 0,
        end: durationSec,
        confidence: 0.95,
      },
    ];
  }

  async *push(
    audioData: Float32Array,
    _metadata?: Readonly<VADAudioMetadata>
  ): AsyncIterableIterator<VADEvent> {
    if (!this.initialized) {
      throw new Error("MockVAD not initialized");
    }

    if (this.latencyMs > 0) {
      await this.delay(this.latencyMs);
    }

    // If custom segments provided, yield them
    if (this.customSegments.length > 0) {
      if (this.currentSegmentIndex < this.customSegments.length) {
        const segment = this.customSegments[this.currentSegmentIndex]!;
        this.currentSegmentIndex++;
        yield { segment, isPartial: false };
      }
      return;
    }

    if (!this.alwaysDetectSpeech || audioData.length === 0) {
      return;
    }

    // Track accumulated samples
    const startSec = this.accumulatedSamples / this.sampleRate;
    this.accumulatedSamples += audioData.length;
    const endSec = this.accumulatedSamples / this.sampleRate;

    // Generate segment for this chunk
    const segment: VADSegment = {
      start: startSec,
      end: endSec,
      confidence: 0.92,
    };

    yield { segment, isPartial: false };
  }

  async flush(): Promise<VADEvent | null> {
    if (!this.initialized) {
      throw new Error("MockVAD not initialized");
    }
    return null;
  }

  getCurrentSegment(): VADSegment | null {
    return null;
  }

  reset(): void {
    this.currentSegmentIndex = 0;
    this.accumulatedSamples = 0;
  }

  async dispose(): Promise<void> {
    this.initialized = false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createMockVAD(options?: Readonly<MockVADOptions>): MockVAD {
  return new MockVAD(options);
}
