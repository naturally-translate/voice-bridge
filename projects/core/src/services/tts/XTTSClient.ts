/**
 * HTTP client for communicating with the XTTS-v2 Python microservice.
 *
 * Provides methods for:
 * - Health checking
 * - Speaker embedding extraction
 * - Speech synthesis with optional embedding
 */
import {
  XTTSServerUnavailableError,
  EmbeddingExtractionError,
  SynthesisFailedError,
  TTSNetworkError,
  UnsupportedTTSLanguageError,
} from "../../errors/TTSError.js";
import type { TTSResult } from "../../interfaces/ITTS.js";

/**
 * Supported target languages for TTS.
 */
const SUPPORTED_LANGUAGES = ["es", "zh", "ko"] as const;
export type TTSTargetLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Speaker embedding extracted from audio.
 */
export interface SpeakerEmbedding {
  readonly data: Float32Array;
  readonly shape: readonly number[];
}

/**
 * Health check response from XTTS server.
 */
export interface XTTSHealthResponse {
  readonly status: string;
  readonly modelLoaded: boolean;
  readonly supportedLanguages: readonly string[];
}

/**
 * Configuration options for XTTSClient.
 */
export interface XTTSClientOptions {
  /** Base URL of the XTTS server. Default: http://localhost:8000 */
  readonly serverUrl?: string;
  /** Request timeout in milliseconds. Default: 30000 (30s) */
  readonly timeoutMs?: number;
  /** Number of retry attempts for failed requests. Default: 2 */
  readonly retryAttempts?: number;
  /** Delay between retries in milliseconds. Default: 1000 (1s) */
  readonly retryDelayMs?: number;
}

/**
 * Options for synthesize requests.
 */
export interface SynthesizeOptions {
  readonly text: string;
  readonly language: TTSTargetLanguage;
  readonly embedding?: SpeakerEmbedding;
  readonly speed?: number;
  readonly signal?: AbortSignal;
  /**
   * If true, retry synthesis without embedding when embedding-based synthesis fails.
   * This provides a fallback to neutral voice when voice cloning fails.
   * Default: false
   */
  readonly fallbackToNeutral?: boolean;
}

/**
 * Options for embedding extraction.
 */
export interface ExtractEmbeddingOptions {
  readonly audio: Float32Array;
  readonly sampleRate: number;
  readonly signal?: AbortSignal;
}

const DEFAULT_SERVER_URL = "http://localhost:8000";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRY_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 1000;

/**
 * HTTP client for the XTTS-v2 TTS microservice.
 *
 * The client is stateless and can be shared across workers.
 * Speaker embeddings are managed externally and passed per request.
 */
export class XTTSClient {
  private readonly serverUrl: string;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;

  constructor(options?: Readonly<XTTSClientOptions>) {
    this.serverUrl = options?.serverUrl ?? DEFAULT_SERVER_URL;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryAttempts = options?.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS;
    this.retryDelayMs = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  /**
   * Check if the XTTS server is healthy and ready.
   */
  async checkHealth(): Promise<XTTSHealthResponse> {
    const response = await this.fetchWithRetry(
      `${this.serverUrl}/health`,
      { method: "GET" }
    );

    if (!response.ok) {
      throw new XTTSServerUnavailableError(
        this.serverUrl,
        `Health check failed with status ${response.status}`
      );
    }

    const data = (await response.json()) as {
      status: string;
      model_loaded: boolean;
      supported_languages: string[];
    };

    return {
      status: data.status,
      modelLoaded: data.model_loaded,
      supportedLanguages: data.supported_languages,
    };
  }

  /**
   * Extract speaker embedding from audio.
   *
   * @param options - Audio data and configuration
   * @returns Speaker embedding that can be reused for synthesis
   * @throws {EmbeddingExtractionError} If extraction fails
   */
  async extractEmbedding(
    options: Readonly<ExtractEmbeddingOptions>
  ): Promise<SpeakerEmbedding> {
    const { audio, sampleRate, signal } = options;

    // Convert Float32Array to base64
    const audioBase64 = this.float32ArrayToBase64(audio);

    const requestInit: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_base64: audioBase64,
        sample_rate: sampleRate,
      }),
    };
    if (signal) {
      requestInit.signal = signal;
    }

    const response = await this.fetchWithRetry(
      `${this.serverUrl}/extract-embedding`,
      requestInit
    );

    if (!response.ok) {
      const errorData = await this.safeParseJson(response);
      throw new EmbeddingExtractionError(
        errorData?.detail ?? `Server returned status ${response.status}`
      );
    }

    const data = (await response.json()) as {
      embedding_base64: string;
      embedding_shape: number[];
      duration_seconds: number;
      processing_time_seconds: number;
    };

    // Convert base64 back to Float32Array
    const embeddingData = this.base64ToFloat32Array(data.embedding_base64);

    return {
      data: embeddingData,
      shape: data.embedding_shape,
    };
  }

  /**
   * Synthesize speech from text.
   *
   * @param options - Synthesis configuration including text, language, and optional embedding
   * @returns Synthesized audio as TTSResult
   * @throws {SynthesisFailedError} If synthesis fails (and fallback is disabled or also fails)
   * @throws {UnsupportedTTSLanguageError} If language is not supported
   */
  async synthesize(options: Readonly<SynthesizeOptions>): Promise<TTSResult> {
    const { text, language, embedding, speed = 1.0, signal, fallbackToNeutral = false } = options;

    // Validate language
    if (!this.isValidLanguage(language)) {
      throw new UnsupportedTTSLanguageError(language, SUPPORTED_LANGUAGES);
    }

    try {
      return await this.doSynthesize(text, language, speed, signal, embedding);
    } catch (error) {
      // If we have an embedding and fallback is enabled, retry without embedding
      if (embedding && fallbackToNeutral) {
        return await this.doSynthesize(text, language, speed, signal, undefined);
      }
      throw error;
    }
  }

  /**
   * Internal synthesis implementation.
   */
  private async doSynthesize(
    text: string,
    language: TTSTargetLanguage,
    speed: number,
    signal: AbortSignal | undefined,
    embedding: SpeakerEmbedding | undefined
  ): Promise<TTSResult> {
    // Prepare request body
    const requestBody: Record<string, unknown> = {
      text,
      language,
      speed,
    };

    if (embedding) {
      requestBody["embedding_base64"] = this.float32ArrayToBase64(embedding.data);
    }

    const requestInit: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    };
    if (signal) {
      requestInit.signal = signal;
    }

    const response = await this.fetchWithRetry(
      `${this.serverUrl}/synthesize`,
      requestInit
    );

    if (!response.ok) {
      const errorData = await this.safeParseJson(response);
      throw new SynthesisFailedError(
        errorData?.detail ?? `Server returned status ${response.status}`,
        text
      );
    }

    const data = (await response.json()) as {
      audio_base64: string;
      sample_rate: number;
      duration_seconds: number;
      processing_time_seconds: number;
      latency_warning?: string;
    };

    // Note: latency_warning is available in data.latency_warning if needed for debugging

    // Convert base64 audio to Float32Array
    const audioData = this.base64ToFloat32Array(data.audio_base64);

    return {
      audio: audioData,
      sampleRate: data.sample_rate,
      duration: data.duration_seconds,
    };
  }

  /**
   * Get the list of supported languages.
   */
  getSupportedLanguages(): readonly TTSTargetLanguage[] {
    return SUPPORTED_LANGUAGES;
  }

  /**
   * Check if a language is supported.
   */
  isValidLanguage(language: string): language is TTSTargetLanguage {
    return SUPPORTED_LANGUAGES.includes(language as TTSTargetLanguage);
  }

  /**
   * Fetch with retry logic and timeout.
   */
  private async fetchWithRetry(
    url: string,
    init: RequestInit
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
      try {
        // Create timeout abort controller
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(
          () => timeoutController.abort(),
          this.timeoutMs
        );

        // Combine with user's abort signal if provided
        const combinedSignal = init.signal
          ? this.combineAbortSignals(init.signal, timeoutController.signal)
          : timeoutController.signal;

        try {
          const response = await fetch(url, {
            ...init,
            signal: combinedSignal,
          });
          clearTimeout(timeoutId);
          return response;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on abort
        if (lastError.name === "AbortError") {
          throw new TTSNetworkError("request", "Request was aborted");
        }

        // Don't retry on last attempt
        if (attempt < this.retryAttempts) {
          await this.delay(this.retryDelayMs);
        }
      }
    }

    throw new XTTSServerUnavailableError(
      this.serverUrl,
      lastError?.message ?? "Unknown error"
    );
  }

  /**
   * Combine multiple abort signals into one.
   */
  private combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();

    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort();
        return controller.signal;
      }
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    return controller.signal;
  }

  /**
   * Convert Float32Array to base64 string.
   */
  private float32ArrayToBase64(array: Float32Array): string {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
  }

  /**
   * Convert base64 string to Float32Array.
   */
  private base64ToFloat32Array(base64: string): Float32Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Float32Array(bytes.buffer);
  }

  /**
   * Safely parse JSON from response, returning null on failure.
   */
  private async safeParseJson(
    response: Response
  ): Promise<{ detail?: string } | null> {
    try {
      return (await response.json()) as { detail?: string };
    } catch {
      return null;
    }
  }

  /**
   * Delay for a specified duration.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a new XTTSClient instance.
 */
export function createXTTSClient(
  options?: Readonly<XTTSClientOptions>
): XTTSClient {
  return new XTTSClient(options);
}
