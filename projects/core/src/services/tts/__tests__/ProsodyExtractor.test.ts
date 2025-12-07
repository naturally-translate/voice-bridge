import { describe, it, expect, beforeEach, vi } from "vitest";

import { ProsodyExtractor, createProsodyExtractor } from "../ProsodyExtractor.js";
import type { XTTSClient, SpeakerEmbedding } from "../XTTSClient.js";
import { InsufficientAudioError } from "../../../errors/TTSError.js";

/**
 * Create a mock XTTSClient for testing.
 */
function createMockClient(): XTTSClient {
  return {
    extractEmbedding: vi.fn().mockResolvedValue({
      data: new Float32Array([0.1, 0.2, 0.3]),
      shape: [3],
    } as SpeakerEmbedding),
    synthesize: vi.fn(),
    checkHealth: vi.fn(),
    getSupportedLanguages: vi.fn().mockReturnValue(["es", "zh", "ko"]),
    isValidLanguage: vi.fn().mockReturnValue(true),
  } as unknown as XTTSClient;
}

/**
 * Generate mock audio of specified duration.
 */
function generateMockAudio(durationSeconds: number, sampleRate = 16000): Float32Array {
  const sampleCount = Math.floor(durationSeconds * sampleRate);
  return new Float32Array(sampleCount);
}

/**
 * Create a mock client with a custom extractEmbedding implementation.
 * Avoids spread operator issues with class instances.
 */
function createFailingMockClient(
  extractEmbeddingMock: ReturnType<typeof vi.fn>
): XTTSClient {
  return {
    extractEmbedding: extractEmbeddingMock,
    synthesize: vi.fn(),
    checkHealth: vi.fn(),
    getSupportedLanguages: vi.fn().mockReturnValue(["es", "zh", "ko"]),
    isValidLanguage: vi.fn().mockReturnValue(true),
  } as unknown as XTTSClient;
}

describe("ProsodyExtractor", () => {
  let mockClient: XTTSClient;

  beforeEach(() => {
    mockClient = createMockClient();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("creates with default options", () => {
      const extractor = new ProsodyExtractor({ client: mockClient });
      expect(extractor.currentState).toBe("accumulating");
    });

    it("accepts custom sample rate", () => {
      const extractor = new ProsodyExtractor({
        client: mockClient,
        sampleRate: 22050,
      });
      expect(extractor).toBeInstanceOf(ProsodyExtractor);
    });

    it("accepts custom duration thresholds", () => {
      const extractor = new ProsodyExtractor({
        client: mockClient,
        minDurationSeconds: 2.0,
        targetDurationSeconds: 4.0,
      });
      expect(extractor).toBeInstanceOf(ProsodyExtractor);
    });
  });

  describe("createProsodyExtractor()", () => {
    it("creates an extractor instance", () => {
      const extractor = createProsodyExtractor({ client: mockClient });
      expect(extractor).toBeInstanceOf(ProsodyExtractor);
    });
  });

  describe("initial state", () => {
    it("starts in accumulating state", () => {
      const extractor = new ProsodyExtractor({ client: mockClient });
      expect(extractor.currentState).toBe("accumulating");
    });

    it("isReady is false initially", () => {
      const extractor = new ProsodyExtractor({ client: mockClient });
      expect(extractor.isReady).toBe(false);
    });

    it("hasMinimumAudio is false initially", () => {
      const extractor = new ProsodyExtractor({ client: mockClient });
      expect(extractor.hasMinimumAudio).toBe(false);
    });

    it("progress is 0 initially", () => {
      const extractor = new ProsodyExtractor({ client: mockClient });
      expect(extractor.progress).toBe(0);
    });

    it("accumulatedDurationSeconds is 0 initially", () => {
      const extractor = new ProsodyExtractor({ client: mockClient });
      expect(extractor.accumulatedDurationSeconds).toBe(0);
    });
  });

  describe("addAudio()", () => {
    it("accumulates audio duration correctly", () => {
      const extractor = new ProsodyExtractor({ client: mockClient });

      // Add 1 second of audio
      const audio = generateMockAudio(1.0);
      extractor.addAudio(audio);

      expect(extractor.accumulatedDurationSeconds).toBeCloseTo(1.0, 1);
    });

    it("updates progress correctly", () => {
      const extractor = new ProsodyExtractor({
        client: mockClient,
        targetDurationSeconds: 6.0,
      });

      // Add 3 seconds (50% of target)
      extractor.addAudio(generateMockAudio(3.0));

      expect(extractor.progress).toBeCloseTo(0.5, 1);
    });

    it("hasMinimumAudio becomes true after min duration", () => {
      const extractor = new ProsodyExtractor({
        client: mockClient,
        minDurationSeconds: 3.0,
      });

      expect(extractor.hasMinimumAudio).toBe(false);

      extractor.addAudio(generateMockAudio(3.5));

      expect(extractor.hasMinimumAudio).toBe(true);
    });

    it("triggers extraction when target duration reached", async () => {
      const extractor = new ProsodyExtractor({
        client: mockClient,
        targetDurationSeconds: 3.0,
      });

      const triggered = extractor.addAudio(generateMockAudio(3.5));

      expect(triggered).toBe(true);
    });

    it("does not trigger extraction before target duration", () => {
      const extractor = new ProsodyExtractor({
        client: mockClient,
        targetDurationSeconds: 6.0,
      });

      const triggered = extractor.addAudio(generateMockAudio(2.0));

      expect(triggered).toBe(false);
    });

    it("ignores new audio when already locked", async () => {
      const extractor = new ProsodyExtractor({
        client: mockClient,
        targetDurationSeconds: 3.0,
      });

      // Add enough audio to trigger extraction
      extractor.addAudio(generateMockAudio(4.0));

      // Wait for extraction to complete
      await extractor.getEmbedding();

      expect(extractor.currentState).toBe("locked");

      // Add more audio - should be ignored
      const result = extractor.addAudio(generateMockAudio(1.0));
      expect(result).toBe(false);
    });
  });

  describe("extractNow()", () => {
    it("extracts embedding when minimum audio available", async () => {
      const extractor = new ProsodyExtractor({
        client: mockClient,
        minDurationSeconds: 3.0,
      });

      extractor.addAudio(generateMockAudio(4.0));

      const embedding = await extractor.extractNow();

      expect(embedding).toBeDefined();
      expect(embedding.data).toBeInstanceOf(Float32Array);
    });

    it("throws InsufficientAudioError when not enough audio", async () => {
      const extractor = new ProsodyExtractor({
        client: mockClient,
        minDurationSeconds: 3.0,
      });

      extractor.addAudio(generateMockAudio(1.0));

      await expect(extractor.extractNow()).rejects.toThrow(InsufficientAudioError);
    });

    it("returns existing embedding when already locked", async () => {
      const extractor = new ProsodyExtractor({
        client: mockClient,
        minDurationSeconds: 3.0,
      });

      extractor.addAudio(generateMockAudio(4.0));

      const embedding1 = await extractor.extractNow();
      const embedding2 = await extractor.extractNow();

      expect(embedding1).toBe(embedding2);
    });
  });

  describe("getEmbedding()", () => {
    it("returns null when no embedding available", async () => {
      const extractor = new ProsodyExtractor({ client: mockClient });

      const embedding = await extractor.getEmbedding();

      expect(embedding).toBeNull();
    });

    it("returns embedding after extraction", async () => {
      const extractor = new ProsodyExtractor({
        client: mockClient,
        targetDurationSeconds: 3.0,
      });

      extractor.addAudio(generateMockAudio(4.0));

      const embedding = await extractor.getEmbedding();

      expect(embedding).not.toBeNull();
      expect(embedding?.data).toBeInstanceOf(Float32Array);
    });
  });

  describe("getEmbeddingSync()", () => {
    it("returns null when not locked", () => {
      const extractor = new ProsodyExtractor({ client: mockClient });

      expect(extractor.getEmbeddingSync()).toBeNull();
    });

    it("returns embedding when locked", async () => {
      const extractor = new ProsodyExtractor({
        client: mockClient,
        targetDurationSeconds: 3.0,
      });

      extractor.addAudio(generateMockAudio(4.0));
      await extractor.getEmbedding();

      expect(extractor.getEmbeddingSync()).not.toBeNull();
    });
  });

  describe("reset()", () => {
    it("resets state to accumulating", async () => {
      const extractor = new ProsodyExtractor({
        client: mockClient,
        targetDurationSeconds: 3.0,
      });

      extractor.addAudio(generateMockAudio(4.0));
      await extractor.getEmbedding();

      expect(extractor.currentState).toBe("locked");

      extractor.reset();

      expect(extractor.currentState).toBe("accumulating");
    });

    it("clears accumulated audio", async () => {
      const extractor = new ProsodyExtractor({ client: mockClient });

      extractor.addAudio(generateMockAudio(2.0));
      expect(extractor.accumulatedDurationSeconds).toBeGreaterThan(0);

      extractor.reset();

      expect(extractor.accumulatedDurationSeconds).toBe(0);
    });

    it("clears embedding", async () => {
      const extractor = new ProsodyExtractor({
        client: mockClient,
        targetDurationSeconds: 3.0,
      });

      extractor.addAudio(generateMockAudio(4.0));
      await extractor.getEmbedding();

      expect(extractor.getEmbeddingSync()).not.toBeNull();

      extractor.reset();

      expect(extractor.getEmbeddingSync()).toBeNull();
    });
  });

  describe("state change listeners", () => {
    it("notifies listener on state change", async () => {
      const extractor = new ProsodyExtractor({
        client: mockClient,
        targetDurationSeconds: 3.0,
      });

      const listener = vi.fn();
      extractor.addStateChangeListener(listener);

      extractor.addAudio(generateMockAudio(4.0));
      await extractor.getEmbedding();

      expect(listener).toHaveBeenCalled();
    });

    it("includes state information in event", async () => {
      const extractor = new ProsodyExtractor({
        client: mockClient,
        targetDurationSeconds: 3.0,
      });

      let capturedEvent: unknown = null;
      extractor.addStateChangeListener((event) => {
        capturedEvent = event;
      });

      extractor.addAudio(generateMockAudio(4.0));
      await extractor.getEmbedding();

      expect(capturedEvent).toHaveProperty("previousState");
      expect(capturedEvent).toHaveProperty("currentState");
      expect(capturedEvent).toHaveProperty("accumulatedDurationSeconds");
    });

    it("can remove listener", async () => {
      const extractor = new ProsodyExtractor({
        client: mockClient,
        targetDurationSeconds: 3.0,
      });

      const listener = vi.fn();
      extractor.addStateChangeListener(listener);
      extractor.removeStateChangeListener(listener);

      extractor.addAudio(generateMockAudio(4.0));
      await extractor.getEmbedding();

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("transitions to error state on extraction failure", async () => {
      const failingClient = createFailingMockClient(
        vi.fn().mockRejectedValue(new Error("Extraction failed"))
      );

      const extractor = new ProsodyExtractor({
        client: failingClient,
        minDurationSeconds: 3.0,
      });

      extractor.addAudio(generateMockAudio(4.0));

      await expect(extractor.extractNow()).rejects.toThrow();
      expect(extractor.currentState).toBe("error");
    });

    it("provides error message after failure", async () => {
      const failingClient = createFailingMockClient(
        vi.fn().mockRejectedValue(new Error("Extraction failed"))
      );

      const extractor = new ProsodyExtractor({
        client: failingClient,
        minDurationSeconds: 3.0,
      });

      extractor.addAudio(generateMockAudio(4.0));

      try {
        await extractor.extractNow();
      } catch {
        // Expected
      }

      expect(extractor.getErrorMessage()).toContain("Extraction failed");
    });

    it("can recover from error state by adding more audio", async () => {
      const failingClient = createFailingMockClient(
        vi
          .fn()
          .mockRejectedValueOnce(new Error("Extraction failed"))
          .mockResolvedValue({
            data: new Float32Array([0.1]),
            shape: [1],
          })
      );

      const extractor = new ProsodyExtractor({
        client: failingClient,
        minDurationSeconds: 3.0,
        targetDurationSeconds: 3.0,
      });

      // First attempt fails
      extractor.addAudio(generateMockAudio(4.0));
      try {
        await extractor.extractNow();
      } catch {
        // Expected
      }

      expect(extractor.currentState).toBe("error");

      // Adding audio resets to accumulating
      extractor.addAudio(generateMockAudio(4.0));
      expect(extractor.currentState).not.toBe("error");
    });
  });
});
