import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

import {
  createNLLBTranslator,
  NLLBTranslator,
} from "../NLLBTranslator.js";
import {
  createMockTranslator,
  MockTranslator,
} from "./__mocks__/MockTranslator.js";
import {
  TRANSFORMERS_CACHE_DIR,
  describeIntegration,
} from "../../../__tests__/testConfig.js";
import {
  TranslatorNotInitializedError,
  UnsupportedLanguageError,
} from "../../../errors/TranslationError.js";
import type { TranslationResult } from "../../../interfaces/ITranslator.js";

/**
 * Unit tests using MockTranslator (fast, hermetic, no network).
 */
describe("NLLBTranslator (unit tests with mock)", () => {
  let translator: MockTranslator;

  beforeEach(async () => {
    translator = createMockTranslator();
    await translator.initialize();
  });

  afterEach(async () => {
    await translator.dispose();
  });

  describe("initialization", () => {
    it("is ready after initialization", () => {
      expect(translator.isReady).toBe(true);
    });

    it("is not ready before initialization", () => {
      const newTranslator = createMockTranslator();
      expect(newTranslator.isReady).toBe(false);
    });
  });

  describe("getSupportedLanguages()", () => {
    it("returns supported language codes", () => {
      const languages = translator.getSupportedLanguages();
      expect(languages).toContain("en");
      expect(languages).toContain("es");
      expect(languages).toContain("zh");
      expect(languages).toContain("ko");
    });
  });

  describe("translate()", () => {
    it("translates to Spanish", async () => {
      const result = await translator.translate("Hello", {
        sourceLanguage: "en",
        targetLanguage: "es",
      });

      expect(result.text).toBe("Hola");
      expect(result.sourceLanguage).toBe("en");
      expect(result.targetLanguage).toBe("es");
      expect(result.isPartial).toBe(false);
    });

    it("translates to Chinese", async () => {
      const result = await translator.translate("Hello", {
        sourceLanguage: "en",
        targetLanguage: "zh",
      });

      expect(result.text).toBe("你好");
      expect(result.targetLanguage).toBe("zh");
    });

    it("translates to Korean", async () => {
      const result = await translator.translate("Hello", {
        sourceLanguage: "en",
        targetLanguage: "ko",
      });

      expect(result.text).toBe("안녕하세요");
      expect(result.targetLanguage).toBe("ko");
    });

    it("handles unknown text with deterministic output", async () => {
      const result = await translator.translate("Unknown text here", {
        sourceLanguage: "en",
        targetLanguage: "es",
      });

      expect(result.text).toBe("[es] Unknown text here");
    });
  });

  describe("error handling", () => {
    it("throws when not initialized", async () => {
      const uninitializedTranslator = createMockTranslator();

      await expect(
        uninitializedTranslator.translate("Hello", {
          sourceLanguage: "en",
          targetLanguage: "es",
        })
      ).rejects.toThrow(TranslatorNotInitializedError);
    });

    it("throws for unsupported source language", async () => {
      await expect(
        translator.translate("Hello", {
          sourceLanguage: "xx",
          targetLanguage: "es",
        })
      ).rejects.toThrow(UnsupportedLanguageError);
    });

    it("throws for unsupported target language", async () => {
      await expect(
        translator.translate("Hello", {
          sourceLanguage: "en",
          targetLanguage: "xx",
        })
      ).rejects.toThrow(UnsupportedLanguageError);
    });
  });

  describe("translateStream()", () => {
    it("yields single final result for short text", async () => {
      const results: TranslationResult[] = [];
      for await (const result of translator.translateStream("Hello", {
        sourceLanguage: "en",
        targetLanguage: "es",
      })) {
        results.push(result);
      }

      expect(results.length).toBe(1);
      expect(results[0]!.isPartial).toBe(false);
      expect(results[0]!.text).toBe("Hola");
    });

    it("yields partial results for multi-sentence text", async () => {
      const text = "Hello there. How are you? I am fine.";
      const results: TranslationResult[] = [];

      for await (const result of translator.translateStream(text, {
        sourceLanguage: "en",
        targetLanguage: "es",
      })) {
        results.push(result);
      }

      // Should have 3 results (one per sentence)
      expect(results.length).toBe(3);

      // First two should be partial
      expect(results[0]!.isPartial).toBe(true);
      expect(results[1]!.isPartial).toBe(true);

      // Last should be final
      expect(results[2]!.isPartial).toBe(false);
    });

    it("accumulates text across partial results", async () => {
      const text = "Good morning. How are you today?";
      const results: TranslationResult[] = [];

      for await (const result of translator.translateStream(text, {
        sourceLanguage: "en",
        targetLanguage: "es",
      })) {
        results.push(result);
      }

      // Each result should have progressively more text
      expect(results.length).toBe(2);
      expect(results[1]!.text.length).toBeGreaterThan(results[0]!.text.length);
    });

    it("throws when not initialized", async () => {
      const uninitializedTranslator = createMockTranslator();

      const collectResults = async (): Promise<void> => {
        for await (const _result of uninitializedTranslator.translateStream(
          "Hello",
          { sourceLanguage: "en", targetLanguage: "es" }
        )) {
          // Should throw
        }
      };

      await expect(collectResults()).rejects.toThrow(TranslatorNotInitializedError);
    });

    it("throws for unsupported language", async () => {
      const collectResults = async (): Promise<void> => {
        for await (const _result of translator.translateStream("Hello", {
          sourceLanguage: "en",
          targetLanguage: "invalid",
        })) {
          // Should throw
        }
      };

      await expect(collectResults()).rejects.toThrow(UnsupportedLanguageError);
    });
  });

  describe("dispose()", () => {
    it("can be disposed", async () => {
      const disposableTranslator = createMockTranslator();
      await disposableTranslator.initialize();
      expect(disposableTranslator.isReady).toBe(true);

      await disposableTranslator.dispose();
      expect(disposableTranslator.isReady).toBe(false);
    });

    it("throws after dispose", async () => {
      const disposableTranslator = createMockTranslator();
      await disposableTranslator.initialize();
      await disposableTranslator.dispose();

      await expect(
        disposableTranslator.translate("Hello", {
          sourceLanguage: "en",
          targetLanguage: "es",
        })
      ).rejects.toThrow(TranslatorNotInitializedError);
    });
  });
});

/**
 * Integration tests using real NLLB model.
 * Only run when RUN_INTEGRATION_TESTS=true.
 * These tests are slow (5-10 min) and require network access.
 */
describeIntegration("NLLBTranslator (integration tests with real model)", () => {
  let translator: NLLBTranslator;

  beforeAll(async () => {
    translator = createNLLBTranslator({
      cacheDir: TRANSFORMERS_CACHE_DIR,
      quantized: true,
    });
    await translator.initialize();
  }, 600000); // 10 minutes timeout for model download

  afterAll(async () => {
    await translator.dispose();
  });

  describe("real model translation", () => {
    it("translates to Spanish", async () => {
      const result = await translator.translate("Hello", {
        sourceLanguage: "en",
        targetLanguage: "es",
      });

      expect(result.text).toBeTruthy();
      expect(result.sourceLanguage).toBe("en");
      expect(result.targetLanguage).toBe("es");
    });

    it("translates to Chinese with Chinese characters", async () => {
      const result = await translator.translate("Good morning", {
        sourceLanguage: "en",
        targetLanguage: "zh",
      });

      const hasChinese = /[\u4e00-\u9fff]/.test(result.text);
      expect(hasChinese).toBe(true);
    });

    it("translates to Korean with Korean characters", async () => {
      const result = await translator.translate("Good morning", {
        sourceLanguage: "en",
        targetLanguage: "ko",
      });

      const hasKorean = /[\uac00-\ud7af]/.test(result.text);
      expect(hasKorean).toBe(true);
    });

    it("accepts NLLB language codes", async () => {
      const result = await translator.translate("Hello", {
        sourceLanguage: "eng_Latn",
        targetLanguage: "spa_Latn",
      });

      expect(result.text).toBeTruthy();
    });
  });

  describe("real model streaming", () => {
    it("streams multi-sentence text", async () => {
      const text = "Hello there. How are you? I am fine.";
      const results: TranslationResult[] = [];

      for await (const result of translator.translateStream(text, {
        sourceLanguage: "en",
        targetLanguage: "es",
      })) {
        results.push(result);
      }

      expect(results.length).toBeGreaterThan(1);
      expect(results[results.length - 1]!.isPartial).toBe(false);
    });
  });
});
