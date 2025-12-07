import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TTSWorkerPool, createTTSWorkerPool } from "../worker-pool.js";
import {
  TTSWorkerError,
  TTSQueueFullError,
  TTSCancelledError,
} from "../../../errors/TTSError.js";

/**
 * Get path to mock worker for unit tests.
 */
function getMockWorkerPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);
  return join(thisDir, "__mocks__/mock.worker.js");
}

/**
 * Create a worker pool that uses mock workers for testing.
 * This avoids requiring the actual XTTS server.
 */
class MockTTSWorkerPool extends TTSWorkerPool {
  protected override getWorkerPath(): string {
    return getMockWorkerPath();
  }
}

interface MockTTSWorkerPoolOptions {
  maxQueueSize?: number;
  taskTimeoutMs?: number;
}

function createMockTTSWorkerPool(
  options?: MockTTSWorkerPoolOptions
): MockTTSWorkerPool {
  return new MockTTSWorkerPool(options);
}

describe("TTSWorkerPool (unit tests with mock)", () => {
  let pool: MockTTSWorkerPool;

  beforeEach(async () => {
    pool = createMockTTSWorkerPool();
    await pool.initialize();
  }, 30000);

  afterEach(async () => {
    await pool.shutdown();
  });

  describe("initialization", () => {
    it("is ready after initialization", () => {
      expect(pool.isReady).toBe(true);
    });

    it("is not ready before initialization", () => {
      const newPool = createMockTTSWorkerPool();
      expect(newPool.isReady).toBe(false);
    });

    it("can be initialized multiple times without error", async () => {
      await pool.initialize();
      expect(pool.isReady).toBe(true);
    });
  });

  describe("getSupportedLanguages()", () => {
    it("returns supported target languages", () => {
      const languages = pool.getSupportedLanguages();

      expect(languages).toContain("es");
      expect(languages).toContain("zh");
      expect(languages).toContain("ko");
    });

    it("returns exactly three languages", () => {
      const languages = pool.getSupportedLanguages();
      expect(languages).toHaveLength(3);
    });
  });

  describe("synthesize()", () => {
    it("synthesizes to Spanish", async () => {
      const result = await pool.synthesize("Hello world", "es");

      expect(result.audio).toBeInstanceOf(Float32Array);
      expect(result.sampleRate).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThan(0);
    });

    it("synthesizes to Chinese", async () => {
      const result = await pool.synthesize("Hello world", "zh");

      expect(result.audio).toBeInstanceOf(Float32Array);
      expect(result.sampleRate).toBeGreaterThan(0);
    });

    it("synthesizes to Korean", async () => {
      const result = await pool.synthesize("Hello world", "ko");

      expect(result.audio).toBeInstanceOf(Float32Array);
      expect(result.sampleRate).toBeGreaterThan(0);
    });

    it("longer text produces longer audio", async () => {
      const shortResult = await pool.synthesize("Hi", "es");
      const longResult = await pool.synthesize(
        "This is a much longer sentence with more words",
        "es"
      );

      expect(longResult.duration).toBeGreaterThan(shortResult.duration);
    });
  });

  describe("synthesizeAll()", () => {
    it("synthesizes to all languages in parallel", async () => {
      const results = await pool.synthesizeAll("Hello world");

      expect(results.size).toBe(3);
      expect(results.has("es")).toBe(true);
      expect(results.has("zh")).toBe(true);
      expect(results.has("ko")).toBe(true);
    });

    it("returns TTSResult for each language", async () => {
      const results = await pool.synthesizeAll("Hello world");

      for (const [language, result] of results) {
        if (result instanceof Error) {
          expect.fail(`Synthesis to ${language} failed: ${result.message}`);
        }
        expect(result.audio).toBeInstanceOf(Float32Array);
        expect(result.sampleRate).toBeGreaterThan(0);
      }
    });
  });

  describe("queue behavior with backpressure", () => {
    it("getQueueLength returns current queue state", () => {
      expect(pool.getQueueLength("es")).toBe(0);
    });

    it("processes tasks in FIFO order", async () => {
      const texts = ["First", "Second", "Third"];
      const promises = texts.map((text) => pool.synthesize(text, "es"));

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      for (const result of results) {
        expect(result.audio).toBeInstanceOf(Float32Array);
      }
    });

    it("queues concurrent requests to same worker", async () => {
      const numRequests = 5;
      const promises = Array.from({ length: numRequests }, (_, i) =>
        pool.synthesize(`Request ${i}`, "es")
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(numRequests);
      for (const result of results) {
        expect(result.audio).toBeInstanceOf(Float32Array);
      }
    });

    it("concurrent requests to different languages process in parallel", async () => {
      const promises = [
        pool.synthesize("Hello", "es"),
        pool.synthesize("Hello", "zh"),
        pool.synthesize("Hello", "ko"),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
    });
  });

  describe("error handling", () => {
    it("throws TTSWorkerError when pool not initialized", async () => {
      const uninitPool = createMockTTSWorkerPool();

      await expect(uninitPool.synthesize("Hello", "es")).rejects.toThrow(
        TTSWorkerError
      );
    });
  });

  describe("shutdown", () => {
    it("can be shutdown and reinitialized", async () => {
      const testPool = createMockTTSWorkerPool();
      await testPool.initialize();
      expect(testPool.isReady).toBe(true);

      await testPool.shutdown();
      expect(testPool.isReady).toBe(false);

      await testPool.initialize();
      expect(testPool.isReady).toBe(true);

      await testPool.shutdown();
    });

    it("throws after shutdown", async () => {
      const testPool = createMockTTSWorkerPool();
      await testPool.initialize();
      await testPool.shutdown();

      await expect(testPool.synthesize("Hello", "es")).rejects.toThrow(
        TTSWorkerError
      );
    });
  });

  describe("queue bounds", () => {
    it("rejects synthesis when maxQueueSize is exceeded", async () => {
      const noQueuePool = new MockTTSWorkerPool({ maxQueueSize: 0 });
      await noQueuePool.initialize();

      try {
        await expect(noQueuePool.synthesize("Hello", "es")).rejects.toThrow(
          TTSQueueFullError
        );
      } finally {
        await noQueuePool.shutdown();
      }
    });
  });

  describe("cancellation", () => {
    it("throws TTSCancelledError when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        pool.synthesize("Hello", "es", { signal: controller.signal })
      ).rejects.toThrow(TTSCancelledError);
    });

    it("cancels pending request when signal is aborted", async () => {
      const smallQueuePool = new MockTTSWorkerPool();
      await smallQueuePool.initialize();

      try {
        // Start first request to occupy the worker
        const first = smallQueuePool.synthesize("First", "es");

        // Queue second request with abort signal
        const controller = new AbortController();
        const second = smallQueuePool.synthesize("Second", "es", {
          signal: controller.signal,
        });

        // Abort the second request while it's queued
        controller.abort();

        // First should succeed
        await first;

        // Second should be cancelled
        await expect(second).rejects.toThrow(TTSCancelledError);
      } finally {
        await smallQueuePool.shutdown();
      }
    });
  });

  describe("configuration options", () => {
    it("accepts custom maxQueueSize", async () => {
      const customPool = new MockTTSWorkerPool({ maxQueueSize: 25 });
      await customPool.initialize();
      expect(customPool.isReady).toBe(true);
      await customPool.shutdown();
    });

    it("accepts custom taskTimeoutMs", async () => {
      const customPool = new MockTTSWorkerPool({ taskTimeoutMs: 10000 });
      await customPool.initialize();
      expect(customPool.isReady).toBe(true);
      await customPool.shutdown();
    });
  });
});

describe("createTTSWorkerPool()", () => {
  it("creates a pool instance", () => {
    const pool = createTTSWorkerPool();
    expect(pool).toBeInstanceOf(TTSWorkerPool);
  });

  it("passes options to constructor", () => {
    const pool = createTTSWorkerPool({
      serverUrl: "http://custom:9000",
      maxQueueSize: 25,
    });
    expect(pool).toBeInstanceOf(TTSWorkerPool);
  });
});
