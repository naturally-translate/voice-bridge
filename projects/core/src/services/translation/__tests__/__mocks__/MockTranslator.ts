/**
 * Mock translator for unit testing without real model downloads.
 * Provides deterministic, fast responses for testing translation logic.
 */
import type {
  ITranslator,
  TranslationOptions,
  TranslationResult,
} from "../../../../interfaces/ITranslator.js";
import {
  TranslatorNotInitializedError,
  UnsupportedLanguageError,
} from "../../../../errors/TranslationError.js";

/**
 * Mock translations for testing.
 * Maps source text to translations per language.
 */
const MOCK_TRANSLATIONS: Record<string, Record<string, string>> = {
  Hello: {
    es: "Hola",
    zh: "你好",
    ko: "안녕하세요",
  },
  "Good morning": {
    es: "Buenos días",
    zh: "早上好",
    ko: "좋은 아침",
  },
  Goodbye: {
    es: "Adiós",
    zh: "再见",
    ko: "안녕히 가세요",
  },
  "Thank you": {
    es: "Gracias",
    zh: "谢谢",
    ko: "감사합니다",
  },
  Yes: {
    es: "Sí",
    zh: "是",
    ko: "예",
  },
  "Hello there.": {
    es: "Hola.",
    zh: "你好。",
    ko: "안녕하세요.",
  },
  "How are you?": {
    es: "¿Cómo estás?",
    zh: "你好吗？",
    ko: "어떻게 지내세요?",
  },
  "I am fine.": {
    es: "Estoy bien.",
    zh: "我很好。",
    ko: "저는 괜찮아요.",
  },
  "Good morning.": {
    es: "Buenos días.",
    zh: "早上好。",
    ko: "좋은 아침.",
  },
  "How are you today?": {
    es: "¿Cómo estás hoy?",
    zh: "你今天好吗？",
    ko: "오늘 어떠세요?",
  },
};

const SUPPORTED_LANGUAGES = ["en", "es", "zh", "ko"] as const;

/**
 * Sentence splitting regex (same as NLLBTranslator).
 */
const SENTENCE_SPLITTER = /(?<=[.!?。！？])\s+/;

export interface MockTranslatorOptions {
  /** Simulated latency in ms per translation (default: 0) */
  readonly latencyMs?: number;
  /** Whether to simulate failures */
  readonly shouldFail?: boolean;
  /** Failure message when shouldFail is true */
  readonly failureMessage?: string;
}

/**
 * Mock translator for fast, deterministic unit tests.
 */
export class MockTranslator implements ITranslator {
  private initialized = false;
  private readonly latencyMs: number;
  private readonly shouldFail: boolean;
  private readonly failureMessage: string;

  constructor(options?: Readonly<MockTranslatorOptions>) {
    this.latencyMs = options?.latencyMs ?? 0;
    this.shouldFail = options?.shouldFail ?? false;
    this.failureMessage = options?.failureMessage ?? "Mock failure";
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
    options: Readonly<TranslationOptions>
  ): Promise<TranslationResult> {
    if (!this.initialized) {
      throw new TranslatorNotInitializedError("MockTranslator");
    }

    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    const { sourceLanguage, targetLanguage } = options;

    if (!SUPPORTED_LANGUAGES.includes(sourceLanguage as typeof SUPPORTED_LANGUAGES[number])) {
      throw new UnsupportedLanguageError(sourceLanguage, [...SUPPORTED_LANGUAGES]);
    }
    if (!SUPPORTED_LANGUAGES.includes(targetLanguage as typeof SUPPORTED_LANGUAGES[number])) {
      throw new UnsupportedLanguageError(targetLanguage, [...SUPPORTED_LANGUAGES]);
    }

    if (this.latencyMs > 0) {
      await this.delay(this.latencyMs);
    }

    const translatedText = this.getMockTranslation(text, targetLanguage);

    return {
      text: translatedText,
      sourceLanguage,
      targetLanguage,
      isPartial: false,
    };
  }

  async *translateStream(
    text: string,
    options: Readonly<TranslationOptions>
  ): AsyncIterableIterator<TranslationResult> {
    if (!this.initialized) {
      throw new TranslatorNotInitializedError("MockTranslator");
    }

    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    const { sourceLanguage, targetLanguage } = options;

    if (!SUPPORTED_LANGUAGES.includes(sourceLanguage as typeof SUPPORTED_LANGUAGES[number])) {
      throw new UnsupportedLanguageError(sourceLanguage, [...SUPPORTED_LANGUAGES]);
    }
    if (!SUPPORTED_LANGUAGES.includes(targetLanguage as typeof SUPPORTED_LANGUAGES[number])) {
      throw new UnsupportedLanguageError(targetLanguage, [...SUPPORTED_LANGUAGES]);
    }

    // Split text into sentences
    const sentences = text.split(SENTENCE_SPLITTER).filter((s) => s.trim());

    // For short text or single sentence, just return final result
    if (sentences.length <= 1) {
      const result = await this.translate(text, options);
      yield result;
      return;
    }

    // Translate sentences progressively
    const translatedParts: string[] = [];

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i]!;
      const isLast = i === sentences.length - 1;

      if (this.latencyMs > 0) {
        await this.delay(this.latencyMs);
      }

      const translatedSentence = this.getMockTranslation(sentence, targetLanguage);
      translatedParts.push(translatedSentence);

      yield {
        text: translatedParts.join(" "),
        sourceLanguage,
        targetLanguage,
        isPartial: !isLast,
      };
    }
  }

  getSupportedLanguages(): readonly string[] {
    return SUPPORTED_LANGUAGES;
  }

  async dispose(): Promise<void> {
    this.initialized = false;
  }

  /**
   * Gets mock translation for text.
   * Returns known translations or generates a deterministic fake.
   */
  private getMockTranslation(text: string, targetLanguage: string): string {
    const known = MOCK_TRANSLATIONS[text]?.[targetLanguage];
    if (known) {
      return known;
    }

    // Generate deterministic fake translation
    // Prefix with language code for verifiability
    return `[${targetLanguage}] ${text}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createMockTranslator(
  options?: Readonly<MockTranslatorOptions>
): MockTranslator {
  return new MockTranslator(options);
}
