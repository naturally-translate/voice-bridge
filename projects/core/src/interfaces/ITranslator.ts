export interface TranslationResult {
  readonly text: string;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  /** Whether this is a partial (streaming) result or the final result */
  readonly isPartial: boolean;
}

export interface TranslationOptions {
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
}

export interface ITranslator {
  initialize(): Promise<void>;
  /** Single-shot translation returning final result */
  translate(text: string, options: Readonly<TranslationOptions>): Promise<TranslationResult>;
  /**
   * Streaming translation yielding partial results followed by final result.
   *
   * NOTE: Current implementation uses sentence-level batching, not token-level
   * streaming. The text is split into sentences, and each sentence is translated
   * as a complete unit. Partial results accumulate as each sentence is processed.
   * True token-by-token streaming would require model modifications.
   */
  translateStream(
    text: string,
    options: Readonly<TranslationOptions>
  ): AsyncIterableIterator<TranslationResult>;
  getSupportedLanguages(): readonly string[];
  dispose(): Promise<void>;
  readonly isReady: boolean;
}
