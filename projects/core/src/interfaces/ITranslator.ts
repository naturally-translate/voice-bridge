export interface TranslationResult {
  readonly text: string;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
}

export interface TranslationOptions {
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
}

export interface ITranslator {
  initialize(): Promise<void>;
  translate(text: string, options: Readonly<TranslationOptions>): Promise<TranslationResult>;
  getSupportedLanguages(): readonly string[];
  dispose(): Promise<void>;
  readonly isReady: boolean;
}
