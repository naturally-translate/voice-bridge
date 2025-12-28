/**
 * Mock XTTS Client for pipeline testing.
 * Simulates speaker embedding extraction without real server.
 */

import type { SpeakerEmbedding } from "../../../../services/tts/XTTSClient.js";

/**
 * Options for MockXTTSClient.
 */
export interface MockXTTSClientOptions {
  /** Simulated latency in ms. Default: 0 */
  readonly latencyMs?: number;
  /** Whether to simulate failures */
  readonly shouldFail?: boolean;
  /** Failure message */
  readonly failureMessage?: string;
}

/**
 * Mock XTTS client for fast testing without real server.
 */
export class MockXTTSClient {
  private readonly latencyMs: number;
  private readonly shouldFail: boolean;
  private readonly failureMessage: string;

  constructor(options?: Readonly<MockXTTSClientOptions>) {
    this.latencyMs = options?.latencyMs ?? 0;
    this.shouldFail = options?.shouldFail ?? false;
    this.failureMessage = options?.failureMessage ?? "Mock XTTS failure";
  }

  async checkHealth(): Promise<{ status: string; version?: string }> {
    if (this.latencyMs > 0) {
      await this.delay(this.latencyMs);
    }

    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    return { status: "healthy", version: "mock-1.0.0" };
  }

  async extractEmbedding(_options: {
    audio: Float32Array;
    sampleRate: number;
    signal?: AbortSignal;
  }): Promise<SpeakerEmbedding> {
    if (this.latencyMs > 0) {
      await this.delay(this.latencyMs);
    }

    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    // Return a mock embedding (512 floating-point values is typical for speaker embeddings)
    const embedding = new Float32Array(512);
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] = Math.sin(i * 0.1) * 0.5;
    }

    return {
      data: embedding,
      shape: [1, 512],
    };
  }

  getSupportedLanguages(): readonly string[] {
    return ["es", "zh", "ko"];
  }

  isValidLanguage(language: string): boolean {
    return ["es", "zh", "ko"].includes(language);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createMockXTTSClient(
  options?: Readonly<MockXTTSClientOptions>
): MockXTTSClient {
  return new MockXTTSClient(options);
}
