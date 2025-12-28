/**
 * Mock TTS Worker Pool for pipeline end-to-end testing.
 * Simulates parallel per-language synthesis without real workers.
 */

import type { TTSResult } from "../../../../interfaces/ITTS.js";

export type TTSTargetLanguage = "es" | "zh" | "ko";

/**
 * Options for MockTTSPool.
 */
export interface MockTTSPoolOptions {
  /** Simulated latency in ms per synthesis. Default: 0 */
  readonly latencyMs?: number;
  /** Languages to simulate as failed */
  readonly failingLanguages?: readonly TTSTargetLanguage[];
  /** Failure message */
  readonly failureMessage?: string;
  /** Sample rate for generated audio. Default: 24000 */
  readonly sampleRate?: number;
}

/**
 * Mock TTS worker pool for fast, deterministic testing.
 */
export class MockTTSPool {
  private initialized = false;
  private readonly latencyMs: number;
  private readonly failingLanguages: Set<TTSTargetLanguage>;
  private readonly failureMessage: string;
  private readonly sampleRate: number;

  constructor(options?: Readonly<MockTTSPoolOptions>) {
    this.latencyMs = options?.latencyMs ?? 0;
    this.failingLanguages = new Set(options?.failingLanguages ?? []);
    this.failureMessage = options?.failureMessage ?? "Mock TTS failure";
    this.sampleRate = options?.sampleRate ?? 24000;
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

  async synthesize(
    text: string,
    targetLanguage: TTSTargetLanguage,
    _options?: { signal?: AbortSignal; embedding?: unknown; speed?: number; fallbackToNeutral?: boolean }
  ): Promise<TTSResult> {
    if (!this.initialized) {
      throw new Error("MockTTSPool not initialized");
    }

    if (this.failingLanguages.has(targetLanguage)) {
      throw new Error(`${this.failureMessage} (${targetLanguage})`);
    }

    if (this.latencyMs > 0) {
      await this.delay(this.latencyMs);
    }

    // Generate mock audio based on text length
    // Approximately 150 words per minute, average 5 chars per word
    const estimatedDurationSec = (text.length / 5) / (150 / 60);
    const numSamples = Math.floor(estimatedDurationSec * this.sampleRate);

    // Generate simple tone as mock audio
    const audio = new Float32Array(Math.max(numSamples, 1000));
    const frequency = targetLanguage === "es" ? 220 : targetLanguage === "zh" ? 260 : 300;

    for (let i = 0; i < audio.length; i++) {
      const t = i / this.sampleRate;
      audio[i] = 0.3 * Math.sin(2 * Math.PI * frequency * t);
    }

    return {
      audio,
      sampleRate: this.sampleRate,
      duration: audio.length / this.sampleRate,
    };
  }

  async synthesizeAll(
    text: string
  ): Promise<Map<TTSTargetLanguage, TTSResult | Error>> {
    const results = new Map<TTSTargetLanguage, TTSResult | Error>();
    const languages: TTSTargetLanguage[] = ["es", "zh", "ko"];

    const promises = languages.map(async (lang) => {
      try {
        const result = await this.synthesize(text, lang);
        results.set(lang, result);
      } catch (error) {
        results.set(
          lang,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    });

    await Promise.all(promises);
    return results;
  }

  getQueueLength(_targetLanguage: TTSTargetLanguage): number {
    return 0;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createMockTTSPool(
  options?: Readonly<MockTTSPoolOptions>
): MockTTSPool {
  return new MockTTSPool(options);
}
