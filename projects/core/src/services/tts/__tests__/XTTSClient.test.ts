import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { XTTSClient, createXTTSClient } from "../XTTSClient.js";
import {
  XTTSServerUnavailableError,
  SynthesisFailedError,
  UnsupportedTTSLanguageError,
} from "../../../errors/TTSError.js";

/**
 * Mock fetch responses for testing.
 */
function createMockFetch(responses: Map<string, unknown>) {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const response = responses.get(path);

    if (!response) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ detail: "Not found" }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => response,
    };
  });
}

describe("XTTSClient", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("uses default server URL when not provided", () => {
      const client = new XTTSClient();
      expect(client).toBeInstanceOf(XTTSClient);
    });

    it("accepts custom server URL", () => {
      const client = new XTTSClient({ serverUrl: "http://custom:9000" });
      expect(client).toBeInstanceOf(XTTSClient);
    });

    it("accepts custom timeout", () => {
      const client = new XTTSClient({ timeoutMs: 5000 });
      expect(client).toBeInstanceOf(XTTSClient);
    });
  });

  describe("createXTTSClient()", () => {
    it("creates a new client instance", () => {
      const client = createXTTSClient();
      expect(client).toBeInstanceOf(XTTSClient);
    });

    it("passes options to constructor", () => {
      const client = createXTTSClient({
        serverUrl: "http://test:8000",
        timeoutMs: 10000,
      });
      expect(client).toBeInstanceOf(XTTSClient);
    });
  });

  describe("checkHealth()", () => {
    it("returns health response when server is healthy", async () => {
      const mockFetch = createMockFetch(
        new Map([
          [
            "/health",
            {
              status: "healthy",
              model_loaded: true,
              supported_languages: ["es", "zh-cn", "ko"],
            },
          ],
        ])
      );
      global.fetch = mockFetch as unknown as typeof global.fetch;

      const client = new XTTSClient();
      const response = await client.checkHealth();

      expect(response.status).toBe("healthy");
      expect(response.modelLoaded).toBe(true);
      expect(response.supportedLanguages).toContain("es");
    });

    it("throws XTTSServerUnavailableError when server fails", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const client = new XTTSClient({ retryAttempts: 0 });

      await expect(client.checkHealth()).rejects.toThrow(
        XTTSServerUnavailableError
      );
    });
  });

  describe("getSupportedLanguages()", () => {
    it("returns supported languages", () => {
      const client = new XTTSClient();
      const languages = client.getSupportedLanguages();

      expect(languages).toContain("es");
      expect(languages).toContain("zh");
      expect(languages).toContain("ko");
      expect(languages).toHaveLength(3);
    });
  });

  describe("isValidLanguage()", () => {
    it.each([
      { language: "es", expected: true },
      { language: "zh", expected: true },
      { language: "ko", expected: true },
      { language: "en", expected: false },
      { language: "fr", expected: false },
      { language: "", expected: false },
    ])("returns $expected for language '$language'", ({ language, expected }) => {
      const client = new XTTSClient();
      expect(client.isValidLanguage(language)).toBe(expected);
    });
  });

  describe("synthesize()", () => {
    it("synthesizes text successfully", async () => {
      // Create mock audio data
      const mockAudio = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      const mockAudioBase64 = btoa(
        String.fromCharCode(...new Uint8Array(mockAudio.buffer))
      );

      const mockFetch = createMockFetch(
        new Map([
          [
            "/synthesize",
            {
              audio_base64: mockAudioBase64,
              sample_rate: 22050,
              duration_seconds: 0.5,
              processing_time_seconds: 0.1,
            },
          ],
        ])
      );
      global.fetch = mockFetch as unknown as typeof global.fetch;

      const client = new XTTSClient();
      const result = await client.synthesize({
        text: "Hello world",
        language: "es",
      });

      expect(result.sampleRate).toBe(22050);
      expect(result.duration).toBe(0.5);
      expect(result.audio).toBeInstanceOf(Float32Array);
    });

    it("throws UnsupportedTTSLanguageError for invalid language", async () => {
      const client = new XTTSClient();

      await expect(
        client.synthesize({
          text: "Hello",
          language: "invalid" as "es",
        })
      ).rejects.toThrow(UnsupportedTTSLanguageError);
    });

    it("throws SynthesisFailedError on server error", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ detail: "Internal server error" }),
      });

      const client = new XTTSClient({ retryAttempts: 0 });

      await expect(
        client.synthesize({
          text: "Hello",
          language: "es",
        })
      ).rejects.toThrow(SynthesisFailedError);
    });

    it("includes speed parameter in request", async () => {
      let capturedBody: string | undefined;

      global.fetch = vi.fn().mockImplementation(async (_url, init) => {
        capturedBody = init?.body as string;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            audio_base64: btoa("test"),
            sample_rate: 22050,
            duration_seconds: 0.5,
            processing_time_seconds: 0.1,
          }),
        };
      });

      const client = new XTTSClient();
      await client.synthesize({
        text: "Hello",
        language: "es",
        speed: 1.5,
      });

      expect(capturedBody).toBeDefined();
      const parsed = JSON.parse(capturedBody!) as Record<string, unknown>;
      expect(parsed["speed"]).toBe(1.5);
    });

    it("handles latency warning in response", async () => {
      // Latency warning is available in response but not logged
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          audio_base64: btoa("test"),
          sample_rate: 22050,
          duration_seconds: 0.5,
          processing_time_seconds: 5.0,
          latency_warning: "Processing time exceeded threshold",
        }),
      });

      const client = new XTTSClient();
      const result = await client.synthesize({
        text: "Hello",
        language: "es",
      });

      // Should still return a valid result even with latency warning
      expect(result.sampleRate).toBe(22050);
      expect(result.duration).toBe(0.5);
    });
  });

  describe("extractEmbedding()", () => {
    it("extracts embedding successfully", async () => {
      const mockEmbedding = new Float32Array([0.1, 0.2, 0.3]);
      const mockEmbeddingBase64 = btoa(
        String.fromCharCode(...new Uint8Array(mockEmbedding.buffer))
      );

      const mockFetch = createMockFetch(
        new Map([
          [
            "/extract-embedding",
            {
              embedding_base64: mockEmbeddingBase64,
              embedding_shape: [3],
              duration_seconds: 3.5,
              processing_time_seconds: 0.5,
            },
          ],
        ])
      );
      global.fetch = mockFetch as unknown as typeof global.fetch;

      const client = new XTTSClient();
      const audio = new Float32Array(48000 * 3); // 3 seconds at 16kHz

      const result = await client.extractEmbedding({
        audio,
        sampleRate: 16000,
      });

      expect(result.data).toBeInstanceOf(Float32Array);
      expect(result.shape).toEqual([3]);
    });
  });

  describe("retry behavior", () => {
    it("retries failed requests", async () => {
      let attemptCount = 0;

      global.fetch = vi.fn().mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("Network error");
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: "healthy",
            model_loaded: true,
            supported_languages: [],
          }),
        };
      });

      const client = new XTTSClient({
        retryAttempts: 3,
        retryDelayMs: 10,
      });

      const response = await client.checkHealth();
      expect(response.status).toBe("healthy");
      expect(attemptCount).toBe(3);
    });

    it("gives up after max retries", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const client = new XTTSClient({
        retryAttempts: 2,
        retryDelayMs: 10,
      });

      await expect(client.checkHealth()).rejects.toThrow(
        XTTSServerUnavailableError
      );
    });
  });
});
