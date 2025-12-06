import { pipeline, type PipelineType } from "@huggingface/transformers";

import type {
  ITranslator,
  TranslationOptions,
  TranslationResult,
} from "../../interfaces/ITranslator.js";
import {
  TranslatorNotInitializedError,
  TranslationFailedError,
  UnsupportedLanguageError,
} from "../../errors/TranslationError.js";

/**
 * NLLB model configuration.
 */
const MODEL_ID = "Xenova/nllb-200-distilled-600M";

/**
 * Mapping from simple language codes to NLLB language codes.
 * NLLB uses BCP-47 style codes with script suffixes.
 */
const LANGUAGE_CODE_MAP: Readonly<Record<string, string>> = {
  en: "eng_Latn",
  es: "spa_Latn",
  zh: "zho_Hans",
  ko: "kor_Hang",
  // Also accept the full NLLB codes directly
  eng_Latn: "eng_Latn",
  spa_Latn: "spa_Latn",
  zho_Hans: "zho_Hans",
  kor_Hang: "kor_Hang",
};

/**
 * Supported simple language codes for external use.
 */
const SUPPORTED_LANGUAGES: readonly string[] = ["en", "es", "zh", "ko"];

/**
 * Sentence splitting regex for streaming translation.
 * Matches sentence-ending punctuation followed by whitespace.
 */
const SENTENCE_SPLITTER = /(?<=[.!?。！？])\s+/;

export interface NLLBTranslatorOptions {
  readonly cacheDir?: string;
  readonly quantized?: boolean;
}

/**
 * Type for the translation pipeline result.
 * The pipeline returns an array of objects with translation_text.
 */
interface TranslationPipelineResult {
  readonly translation_text: string;
}

/**
 * Translation using NLLB-200 distilled 600M model.
 *
 * Uses Transformers.js for inference with ONNX backend.
 * Supports translation from English to Spanish, Chinese (Simplified), and Korean.
 */
export class NLLBTranslator implements ITranslator {
  private readonly cacheDir: string | null;
  private readonly quantized: boolean;

  private translator:
    | ((
        text: string,
        options: { src_lang: string; tgt_lang: string }
      ) => Promise<TranslationPipelineResult[]>)
    | null = null;

  constructor(options?: Readonly<NLLBTranslatorOptions>) {
    this.cacheDir = options?.cacheDir ?? null;
    this.quantized = options?.quantized ?? true;
  }

  get isReady(): boolean {
    return this.translator !== null;
  }

  async initialize(): Promise<void> {
    if (this.translator) {
      return;
    }

    const pipelineOptions: {
      quantized: boolean;
      cache_dir?: string;
    } = {
      quantized: this.quantized,
    };

    if (this.cacheDir) {
      pipelineOptions.cache_dir = this.cacheDir;
    }

    // Create the translation pipeline
    // The pipeline function returns a callable that performs translation
    this.translator = (await pipeline(
      "translation" as PipelineType,
      MODEL_ID,
      pipelineOptions
    )) as unknown as (
      text: string,
      options: { src_lang: string; tgt_lang: string }
    ) => Promise<TranslationPipelineResult[]>;
  }

  async translate(
    text: string,
    options: Readonly<TranslationOptions>
  ): Promise<TranslationResult> {
    if (!this.translator) {
      throw new TranslatorNotInitializedError("NLLBTranslator");
    }

    const { sourceLanguage, targetLanguage } = options;

    // Map simple codes to NLLB codes
    const srcLang = this.mapLanguageCode(sourceLanguage);
    const tgtLang = this.mapLanguageCode(targetLanguage);

    // Validate languages
    if (!srcLang) {
      throw new UnsupportedLanguageError(sourceLanguage, SUPPORTED_LANGUAGES);
    }
    if (!tgtLang) {
      throw new UnsupportedLanguageError(targetLanguage, SUPPORTED_LANGUAGES);
    }

    try {
      const result = await this.translator(text, {
        src_lang: srcLang,
        tgt_lang: tgtLang,
      });

      // The pipeline returns an array of results
      const translatedText = result[0]?.translation_text;

      if (translatedText === undefined) {
        throw new TranslationFailedError(
          "No translation result produced",
          text
        );
      }

      return {
        text: translatedText,
        sourceLanguage,
        targetLanguage,
        isPartial: false,
      };
    } catch (error) {
      // Re-throw our own errors
      if (error instanceof TranslationFailedError) {
        throw error;
      }

      // Wrap unexpected errors
      const message = error instanceof Error ? error.message : String(error);
      throw new TranslationFailedError(message, text);
    }
  }

  /**
   * Streaming translation that yields partial results as sentences are translated.
   * Splits input text into sentences and translates them progressively.
   * Yields partial results (isPartial=true) followed by final result (isPartial=false).
   */
  async *translateStream(
    text: string,
    options: Readonly<TranslationOptions>
  ): AsyncIterableIterator<TranslationResult> {
    if (!this.translator) {
      throw new TranslatorNotInitializedError("NLLBTranslator");
    }

    const { sourceLanguage, targetLanguage } = options;

    // Map simple codes to NLLB codes
    const srcLang = this.mapLanguageCode(sourceLanguage);
    const tgtLang = this.mapLanguageCode(targetLanguage);

    // Validate languages
    if (!srcLang) {
      throw new UnsupportedLanguageError(sourceLanguage, SUPPORTED_LANGUAGES);
    }
    if (!tgtLang) {
      throw new UnsupportedLanguageError(targetLanguage, SUPPORTED_LANGUAGES);
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

      try {
        const result = await this.translator(sentence, {
          src_lang: srcLang,
          tgt_lang: tgtLang,
        });

        const translatedSentence = result[0]?.translation_text ?? "";
        translatedParts.push(translatedSentence);

        // Yield accumulated result
        yield {
          text: translatedParts.join(" "),
          sourceLanguage,
          targetLanguage,
          isPartial: !isLast,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new TranslationFailedError(message, sentence);
      }
    }
  }

  getSupportedLanguages(): readonly string[] {
    return SUPPORTED_LANGUAGES;
  }

  async dispose(): Promise<void> {
    // Transformers.js pipelines don't have explicit dispose, but we can clear references
    this.translator = null;
  }

  /**
   * Maps a simple language code to an NLLB language code.
   * Returns undefined if the language is not supported.
   */
  private mapLanguageCode(code: string): string | undefined {
    return LANGUAGE_CODE_MAP[code];
  }
}

export function createNLLBTranslator(
  options?: Readonly<NLLBTranslatorOptions>
): NLLBTranslator {
  return new NLLBTranslator(options);
}
