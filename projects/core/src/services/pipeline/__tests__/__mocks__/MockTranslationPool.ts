/**
 * Mock Translation Worker Pool for pipeline end-to-end testing.
 * Simulates parallel per-language translation without real workers.
 */

import type { TranslationResult } from "../../../../interfaces/ITranslator.js";

export type TargetLanguage = "es" | "zh" | "ko";

/**
 * Mock translations for common phrases.
 */
const MOCK_TRANSLATIONS: Record<string, Record<TargetLanguage, string>> = {
  "Hello, how are you today?": {
    es: "Hola, ¿cómo estás hoy?",
    zh: "你好，你今天好吗？",
    ko: "안녕하세요, 오늘 어떠세요?",
  },
  "Hello, how": {
    es: "Hola, cómo",
    zh: "你好，怎么",
    ko: "안녕, 어떻게",
  },
  Hello: {
    es: "Hola",
    zh: "你好",
    ko: "안녕하세요",
  },
};

/**
 * Options for MockTranslationPool.
 */
export interface MockTranslationPoolOptions {
  /** Simulated latency in ms per translation. Default: 0 */
  readonly latencyMs?: number;
  /** Languages to simulate as failed */
  readonly failingLanguages?: readonly TargetLanguage[];
  /** Failure message */
  readonly failureMessage?: string;
}

/**
 * Mock translation worker pool for fast, deterministic testing.
 */
export class MockTranslationPool {
  private initialized = false;
  private readonly latencyMs: number;
  private readonly failingLanguages: Set<TargetLanguage>;
  private readonly failureMessage: string;

  constructor(options?: Readonly<MockTranslationPoolOptions>) {
    this.latencyMs = options?.latencyMs ?? 0;
    this.failingLanguages = new Set(options?.failingLanguages ?? []);
    this.failureMessage = options?.failureMessage ?? "Mock translation failure";
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

  async translate(
    text: string,
    targetLanguage: TargetLanguage,
    _options?: { signal?: AbortSignal }
  ): Promise<TranslationResult> {
    if (!this.initialized) {
      throw new Error("MockTranslationPool not initialized");
    }

    if (this.failingLanguages.has(targetLanguage)) {
      throw new Error(`${this.failureMessage} (${targetLanguage})`);
    }

    if (this.latencyMs > 0) {
      await this.delay(this.latencyMs);
    }

    const translatedText = this.getMockTranslation(text, targetLanguage);

    return {
      text: translatedText,
      sourceLanguage: "en",
      targetLanguage,
      isPartial: false,
    };
  }

  async *translateStream(
    text: string,
    targetLanguage: TargetLanguage,
    _options?: { signal?: AbortSignal }
  ): AsyncIterableIterator<TranslationResult> {
    // Just yield the final result for simplicity
    const result = await this.translate(text, targetLanguage);
    yield result;
  }

  async translateAll(
    text: string
  ): Promise<Map<TargetLanguage, TranslationResult | Error>> {
    const results = new Map<TargetLanguage, TranslationResult | Error>();
    const languages: TargetLanguage[] = ["es", "zh", "ko"];

    const promises = languages.map(async (lang) => {
      try {
        const result = await this.translate(text, lang);
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

  getQueueLength(_targetLanguage: TargetLanguage): number {
    return 0;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  private getMockTranslation(text: string, targetLanguage: TargetLanguage): string {
    const known = MOCK_TRANSLATIONS[text]?.[targetLanguage];
    if (known) {
      return known;
    }
    // Generate deterministic fake translation
    return `[${targetLanguage}] ${text}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createMockTranslationPool(
  options?: Readonly<MockTranslationPoolOptions>
): MockTranslationPool {
  return new MockTranslationPool(options);
}
