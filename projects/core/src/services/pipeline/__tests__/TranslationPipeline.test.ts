/**
 * Tests for TranslationPipeline.
 *
 * Uses mock services for fast, hermetic unit tests.
 * Integration tests with real models are in a separate file.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
} from "vitest";

import {
  PipelineContext,
  createPipelineContext,
} from "../PipelineContext.js";
import {
  PipelineMetrics,
  createPipelineMetrics,
} from "../PipelineMetrics.js";
import {
  type TargetLanguage,
  TARGET_LANGUAGES,
  DEFAULT_PIPELINE_CONFIG,
  generateId,
  getTimestamp,
  isTargetLanguage,
  isError,
} from "../PipelineTypes.js";
import {
  PipelineNotInitializedError,
  PipelineShutdownError,
  LanguageProcessingError,
  StageFailedError,
  ThresholdExceededError,
} from "../../../errors/PipelineError.js";

describe("PipelineTypes", () => {
  describe("TARGET_LANGUAGES", () => {
    it("contains exactly three languages", () => {
      expect(TARGET_LANGUAGES).toHaveLength(3);
    });

    it("includes es, zh, ko", () => {
      expect(TARGET_LANGUAGES).toContain("es");
      expect(TARGET_LANGUAGES).toContain("zh");
      expect(TARGET_LANGUAGES).toContain("ko");
    });
  });

  describe("isTargetLanguage()", () => {
    it("returns true for valid target languages", () => {
      expect(isTargetLanguage("es")).toBe(true);
      expect(isTargetLanguage("zh")).toBe(true);
      expect(isTargetLanguage("ko")).toBe(true);
    });

    it("returns false for invalid languages", () => {
      expect(isTargetLanguage("en")).toBe(false);
      expect(isTargetLanguage("fr")).toBe(false);
      expect(isTargetLanguage("")).toBe(false);
    });
  });

  describe("generateId()", () => {
    it("generates unique IDs with prefix", () => {
      const id1 = generateId("test");
      const id2 = generateId("test");

      expect(id1).toMatch(/^test-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe("getTimestamp()", () => {
    it("returns current timestamp in milliseconds", () => {
      const before = Date.now();
      const timestamp = getTimestamp();
      const after = Date.now();

      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("isError()", () => {
    it("returns true for Error instances", () => {
      expect(isError(new Error("test"))).toBe(true);
      expect(isError(new TypeError("test"))).toBe(true);
    });

    it("returns false for non-Error values", () => {
      expect(isError("error")).toBe(false);
      expect(isError(null)).toBe(false);
      expect(isError(undefined)).toBe(false);
      expect(isError({ message: "error" })).toBe(false);
    });
  });
});

describe("PipelineContext", () => {
  let context: PipelineContext;

  beforeEach(() => {
    context = createPipelineContext({
      sessionId: "test-session",
      config: {
        targetLanguages: ["es", "zh", "ko"],
        enableProsodyMatching: false, // Disable for simpler testing
      },
    });
  });

  describe("initialization", () => {
    it("generates session ID if not provided", () => {
      const ctx = createPipelineContext();
      expect(ctx.sessionId).toMatch(/^session-/);
    });

    it("uses provided session ID", () => {
      expect(context.sessionId).toBe("test-session");
    });

    it("starts in created state", () => {
      expect(context.currentState).toBe("created");
    });

    it("is not active initially", () => {
      expect(context.isActive).toBe(false);
    });
  });

  describe("state transitions", () => {
    it("transitions to active on start()", () => {
      context.start();
      expect(context.currentState).toBe("active");
      expect(context.isActive).toBe(true);
    });

    it("transitions to paused on pause()", () => {
      context.start();
      context.pause();
      expect(context.currentState).toBe("paused");
      expect(context.isActive).toBe(false);
    });

    it("transitions to completed on complete()", () => {
      context.start();
      context.complete();
      expect(context.currentState).toBe("completed");
    });

    it("transitions to error on setError()", () => {
      context.start();
      context.setError();
      expect(context.currentState).toBe("error");
    });
  });

  describe("language management", () => {
    it("returns all configured languages as active", () => {
      const languages = context.getActiveLanguages();
      expect(languages).toContain("es");
      expect(languages).toContain("zh");
      expect(languages).toContain("ko");
    });

    it("can check if language is active", () => {
      expect(context.isLanguageActive("es")).toBe(true);
    });

    it("can deactivate a language", () => {
      context.setLanguageActive("es", false);
      expect(context.isLanguageActive("es")).toBe(false);
      expect(context.getActiveLanguages()).not.toContain("es");
    });

    it("can reactivate a language", () => {
      context.setLanguageActive("es", false);
      context.setLanguageActive("es", true);
      expect(context.isLanguageActive("es")).toBe(true);
    });
  });

  describe("segment storage", () => {
    it("stores and retrieves segments", () => {
      const segment = {
        id: "seg-1",
        startTime: getTimestamp(),
        vadSegment: { start: 0, end: 1, confidence: 0.9 },
        audioSamples: new Float32Array(1000),
      };

      context.storeSegment(segment);
      const retrieved = context.getSegment("seg-1");

      expect(retrieved).toEqual(segment);
    });

    it("returns undefined for unknown segment", () => {
      expect(context.getSegment("unknown")).toBeUndefined();
    });
  });

  describe("transcription storage", () => {
    it("stores and retrieves transcriptions", () => {
      const transcription = {
        id: "trans-1",
        segmentId: "seg-1",
        startTime: getTimestamp(),
        result: { text: "Hello", language: "en", isPartial: false },
      };

      context.storeTranscription(transcription);
      const retrieved = context.getTranscription("trans-1");

      expect(retrieved).toEqual(transcription);
    });
  });

  describe("reset()", () => {
    it("resets all state", () => {
      context.start();
      context.storeSegment({
        id: "seg-1",
        startTime: getTimestamp(),
        vadSegment: { start: 0, end: 1, confidence: 0.9 },
        audioSamples: new Float32Array(1000),
      });
      context.setLanguageActive("es", false);

      context.reset();

      expect(context.currentState).toBe("created");
      expect(context.getSegment("seg-1")).toBeUndefined();
      expect(context.isLanguageActive("es")).toBe(true);
    });
  });

  describe("getSessionInfo()", () => {
    it("returns session info object", () => {
      context.start();
      const info = context.getSessionInfo();

      expect(info.sessionId).toBe("test-session");
      expect(info.state).toBe("active");
      expect(info.activeLanguages).toContain("es");
      expect(info.prosodyState).toBe("disabled");
    });
  });
});

describe("PipelineMetrics", () => {
  let metrics: PipelineMetrics;

  beforeEach(() => {
    metrics = createPipelineMetrics({
      latencyThresholdMs: 4000,
      memoryThresholdMB: 10000,
    });
  });

  describe("operation tracking", () => {
    it("tracks VAD timing", () => {
      metrics.startOperation();
      metrics.startVAD();
      metrics.endVAD();

      const snapshot = metrics.getSnapshot();
      expect(snapshot.latency.vad).toBeGreaterThanOrEqual(0);
    });

    it("tracks ASR timing", () => {
      metrics.startOperation();
      metrics.startASR();
      metrics.endASR();

      const snapshot = metrics.getSnapshot();
      expect(snapshot.latency.asr).toBeGreaterThanOrEqual(0);
    });

    it("tracks per-language translation timing", () => {
      metrics.startOperation();
      metrics.startTranslation("es");
      metrics.endTranslation("es", true);

      const snapshot = metrics.getSnapshot();
      expect(snapshot.latency.translation.es).toBeGreaterThanOrEqual(0);
    });

    it("tracks per-language synthesis timing", () => {
      metrics.startOperation();
      metrics.startSynthesis("zh");
      metrics.endSynthesis("zh", true);

      const snapshot = metrics.getSnapshot();
      expect(snapshot.latency.synthesis.zh).toBeGreaterThanOrEqual(0);
    });
  });

  describe("language status", () => {
    it("initializes all languages as active", () => {
      for (const lang of TARGET_LANGUAGES) {
        const status = metrics.getLanguageStatus(lang);
        expect(status?.isActive).toBe(true);
        expect(status?.errorCount).toBe(0);
        expect(status?.successCount).toBe(0);
      }
    });

    it("tracks success count", () => {
      metrics.startOperation();
      metrics.startTranslation("es");
      metrics.endTranslation("es", true);

      const status = metrics.getLanguageStatus("es");
      expect(status?.successCount).toBe(1);
    });

    it("tracks error count", () => {
      metrics.startOperation();
      metrics.startTranslation("es");
      metrics.endTranslation("es", false);

      const status = metrics.getLanguageStatus("es");
      expect(status?.errorCount).toBe(1);
    });

    it("can set language active state", () => {
      metrics.setLanguageActive("ko", false);
      expect(metrics.getLanguageStatus("ko")?.isActive).toBe(false);
    });
  });

  describe("threshold violations", () => {
    it("detects memory threshold violation", () => {
      // Create metrics with very low threshold
      const lowThresholdMetrics = createPipelineMetrics({
        latencyThresholdMs: 4000,
        memoryThresholdMB: 1, // 1MB - will be exceeded
      });

      const snapshot = lowThresholdMetrics.getSnapshot();
      expect(snapshot.thresholdViolation).toBe(true);
      expect(snapshot.violations.some((v) => v.type === "memory")).toBe(true);
    });
  });

  describe("average latency", () => {
    it("calculates average over operations", () => {
      // Simulate multiple operations
      for (let i = 0; i < 3; i++) {
        metrics.startOperation();
        metrics.startVAD();
        metrics.endVAD();
        metrics.finalizeOperation();
      }

      const avg = metrics.getAverageLatency();
      expect(avg.vad).toBeGreaterThanOrEqual(0);
    });

    it("returns zeros when no operations recorded", () => {
      const avg = metrics.getAverageLatency();
      expect(avg.vad).toBe(0);
      expect(avg.asr).toBe(0);
      expect(avg.total).toBe(0);
    });
  });

  describe("createMetricsEvent()", () => {
    it("creates valid metrics event", () => {
      metrics.startOperation();
      const event = metrics.createMetricsEvent();

      expect(event.type).toBe("metrics");
      expect(event.timestamp).toBeGreaterThan(0);
      expect(event.latencyMs).toBeDefined();
      expect(event.memoryMB).toBeGreaterThan(0);
      expect(event.languageStatus).toBeDefined();
    });
  });

  describe("reset()", () => {
    it("clears all metrics", () => {
      metrics.startOperation();
      metrics.startVAD();
      metrics.endVAD();
      metrics.startTranslation("es");
      metrics.endTranslation("es", false);
      metrics.finalizeOperation();

      metrics.reset();

      const avg = metrics.getAverageLatency();
      expect(avg.vad).toBe(0);

      const status = metrics.getLanguageStatus("es");
      expect(status?.errorCount).toBe(0);
    });
  });
});

describe("Pipeline Errors", () => {
  describe("PipelineNotInitializedError", () => {
    it("has correct code", () => {
      const error = new PipelineNotInitializedError();
      expect(error.code).toBe("PIPELINE_001");
    });

    it("includes pipeline name in message", () => {
      const error = new PipelineNotInitializedError("CustomPipeline");
      expect(error.message).toContain("CustomPipeline");
    });
  });

  describe("PipelineShutdownError", () => {
    it("has correct code", () => {
      const error = new PipelineShutdownError();
      expect(error.code).toBe("PIPELINE_002");
    });
  });

  describe("LanguageProcessingError", () => {
    it("includes language and stage", () => {
      const error = new LanguageProcessingError("es", "translation", "timeout");
      expect(error.targetLanguage).toBe("es");
      expect(error.stage).toBe("translation");
      expect(error.message).toContain("es");
      expect(error.message).toContain("translation");
    });
  });

  describe("StageFailedError", () => {
    it("includes stage in message", () => {
      const error = new StageFailedError("asr", "model failed");
      expect(error.stage).toBe("asr");
      expect(error.message).toContain("asr");
    });
  });

  describe("ThresholdExceededError", () => {
    it("includes metric details", () => {
      const error = new ThresholdExceededError("latency", 5000, 4000, "ms");
      expect(error.metric).toBe("latency");
      expect(error.value).toBe(5000);
      expect(error.threshold).toBe(4000);
      expect(error.unit).toBe("ms");
    });
  });
});

describe("Fire-and-Forget Behavior", () => {
  it("isolates language failures with Promise.allSettled", async () => {
    // Simulate fire-and-forget pattern with Promise.allSettled
    const translations = TARGET_LANGUAGES.map(async (lang) => {
      if (lang === "zh") {
        throw new Error("Chinese translation failed");
      }
      return { language: lang, text: `[${lang}] Hello` };
    });

    const results = await Promise.allSettled(translations);

    // Spanish and Korean should succeed
    const esResult = results[0];
    const koResult = results[2];
    expect(esResult?.status).toBe("fulfilled");
    expect(koResult?.status).toBe("fulfilled");

    // Chinese should fail
    const zhResult = results[1];
    expect(zhResult?.status).toBe("rejected");
  });

  it("continues processing after individual language failure", async () => {
    const processedLanguages: TargetLanguage[] = [];
    const errors: { language: TargetLanguage; error: Error }[] = [];

    const processLanguage = async (lang: TargetLanguage): Promise<void> => {
      if (lang === "ko") {
        throw new Error("Korean processing failed");
      }
      processedLanguages.push(lang);
    };

    // Process all languages with fire-and-forget
    const promises = TARGET_LANGUAGES.map(async (lang) => {
      try {
        await processLanguage(lang);
      } catch (error) {
        errors.push({
          language: lang,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    });

    await Promise.all(promises);

    // Two languages processed successfully
    expect(processedLanguages).toContain("es");
    expect(processedLanguages).toContain("zh");
    expect(processedLanguages).not.toContain("ko");

    // One error recorded
    expect(errors).toHaveLength(1);
    expect(errors[0]?.language).toBe("ko");
  });
});

describe("Pipeline Configuration", () => {
  it("uses default configuration values", () => {
    expect(DEFAULT_PIPELINE_CONFIG.targetLanguages).toEqual(["es", "zh", "ko"]);
    expect(DEFAULT_PIPELINE_CONFIG.enableProsodyMatching).toBe(true);
    expect(DEFAULT_PIPELINE_CONFIG.latencyThresholdMs).toBe(4000);
    expect(DEFAULT_PIPELINE_CONFIG.memoryThresholdMB).toBe(10000);
    expect(DEFAULT_PIPELINE_CONFIG.metricsIntervalMs).toBe(5000);
    expect(DEFAULT_PIPELINE_CONFIG.sampleRate).toBe(16000);
  });

  it("allows configuration overrides", () => {
    const context = createPipelineContext({
      config: {
        latencyThresholdMs: 2000,
        targetLanguages: ["es"],
      },
    });

    expect(context.config.latencyThresholdMs).toBe(2000);
    expect(context.config.targetLanguages).toEqual(["es"]);
    // Other values should use defaults
    expect(context.config.enableProsodyMatching).toBe(true);
  });
});

describe("Latency Benchmark Recording", () => {
  it("records latency for each stage", async () => {
    const metrics = createPipelineMetrics({
      latencyThresholdMs: 4000,
      memoryThresholdMB: 10000,
    });

    metrics.startOperation();

    // Simulate VAD
    metrics.startVAD();
    await new Promise((r) => setTimeout(r, 10));
    metrics.endVAD();

    // Simulate ASR
    metrics.startASR();
    await new Promise((r) => setTimeout(r, 10));
    metrics.endASR();

    // Simulate Translation (parallel for all languages)
    for (const lang of TARGET_LANGUAGES) {
      metrics.startTranslation(lang);
    }
    await new Promise((r) => setTimeout(r, 10));
    for (const lang of TARGET_LANGUAGES) {
      metrics.endTranslation(lang, true);
    }

    // Simulate TTS (parallel for all languages)
    for (const lang of TARGET_LANGUAGES) {
      metrics.startSynthesis(lang);
    }
    await new Promise((r) => setTimeout(r, 10));
    for (const lang of TARGET_LANGUAGES) {
      metrics.endSynthesis(lang, true);
    }

    metrics.finalizeOperation();

    const snapshot = metrics.getSnapshot();

    // All stages should have recorded latency
    expect(snapshot.latency.vad).toBeGreaterThan(0);
    expect(snapshot.latency.asr).toBeGreaterThan(0);
    expect(snapshot.latency.translation.es).toBeGreaterThan(0);
    expect(snapshot.latency.translation.zh).toBeGreaterThan(0);
    expect(snapshot.latency.translation.ko).toBeGreaterThan(0);
    expect(snapshot.latency.synthesis.es).toBeGreaterThan(0);
    expect(snapshot.latency.synthesis.zh).toBeGreaterThan(0);
    expect(snapshot.latency.synthesis.ko).toBeGreaterThan(0);
    expect(snapshot.latency.total).toBeGreaterThan(0);

    // Verify total latency is reasonable for test (should be > sum of stage delays)
    expect(snapshot.latency.total).toBeGreaterThan(30);
  });
});

describe("Memory Tracking", () => {
  it("reports current memory usage", () => {
    const metrics = createPipelineMetrics({
      latencyThresholdMs: 4000,
      memoryThresholdMB: 10000,
    });

    const snapshot = metrics.getSnapshot();

    // Memory should be positive (Node.js process memory)
    expect(snapshot.memoryMB).toBeGreaterThan(0);

    // Should be reasonable for a Node.js process (typically 50-200 MB)
    expect(snapshot.memoryMB).toBeLessThan(1000);
  });

  it("detects memory threshold violation", () => {
    // Use impossibly low threshold to trigger violation
    const metrics = createPipelineMetrics({
      latencyThresholdMs: 4000,
      memoryThresholdMB: 0.001, // 1KB - will be exceeded
    });

    const snapshot = metrics.getSnapshot();
    expect(snapshot.thresholdViolation).toBe(true);
    expect(snapshot.violations.some((v) => v.type === "memory")).toBe(true);
  });
});

// =============================================================================
// End-to-End Pipeline Tests with Mocked Services
// =============================================================================

import {
  TranslationPipeline,
  createTranslationPipeline,
} from "../TranslationPipeline.js";
import type { PipelineEvent } from "../PipelineTypes.js";
import { createMockVAD, MockVAD } from "./__mocks__/MockVAD.js";
import { createMockASR, MockASR } from "./__mocks__/MockASR.js";
import {
  createMockTranslationPool,
  MockTranslationPool,
} from "./__mocks__/MockTranslationPool.js";
import { createMockTTSPool, MockTTSPool } from "./__mocks__/MockTTSPool.js";
import { createMockXTTSClient } from "./__mocks__/MockXTTSClient.js";
import type { XTTSClient } from "../../tts/XTTSClient.js";
import {
  generateSpeechLike,
  generateLongMixedAudio,
  SAMPLE_RATE,
} from "../../../__fixtures__/audio/generateFixtures.js";

/**
 * Helper to create a pipeline with mocked dependencies for testing.
 */
async function createTestPipeline(options?: {
  vadOptions?: Parameters<typeof createMockVAD>[0];
  asrOptions?: Parameters<typeof createMockASR>[0];
  translationOptions?: Parameters<typeof createMockTranslationPool>[0];
  ttsOptions?: Parameters<typeof createMockTTSPool>[0];
}): Promise<{
  pipeline: TranslationPipeline;
  mocks: {
    vad: MockVAD;
    asr: MockASR;
    translationPool: MockTranslationPool;
    ttsPool: MockTTSPool;
  };
}> {
  const vad = createMockVAD(options?.vadOptions);
  const asr = createMockASR(options?.asrOptions);
  const translationPool = createMockTranslationPool(options?.translationOptions);
  const ttsPool = createMockTTSPool(options?.ttsOptions);

  // Initialize mocks
  await vad.initialize();
  await asr.initialize();
  await translationPool.initialize();
  await ttsPool.initialize();

  // Create pipeline
  const pipeline = createTranslationPipeline({
    sessionId: "test-e2e",
    config: {
      enableProsodyMatching: false, // Disable for simpler testing
      targetLanguages: ["es", "zh", "ko"],
    },
  });

  // Inject mocked dependencies by accessing private field
  // This is a test-only pattern - in production, use proper DI
  const pipelineAny = pipeline as unknown as {
    state: string;
    deps: {
      vad: MockVAD;
      asr: MockASR;
      translationPool: MockTranslationPool;
      ttsPool: MockTTSPool;
      xttsClient: ReturnType<typeof createMockXTTSClient>;
    };
    context: ReturnType<typeof createPipelineContext>;
    startMetricsInterval: () => void;
  };

  // Create context
  const xttsClient = createMockXTTSClient();

  const context = createPipelineContext({
    sessionId: "test-e2e",
    config: {
      enableProsodyMatching: false,
      targetLanguages: ["es", "zh", "ko"],
    },
    xttsClient: xttsClient as unknown as XTTSClient,
  });
  context.start();

  // Inject dependencies
  pipelineAny.state = "ready";
  pipelineAny.deps = {
    vad,
    asr,
    translationPool,
    ttsPool,
    xttsClient,
  };
  pipelineAny.context = context;

  return {
    pipeline,
    mocks: { vad, asr, translationPool, ttsPool },
  };
}

/**
 * Collects all events from a pipeline processing call.
 */
async function collectEvents(
  iterator: AsyncIterableIterator<PipelineEvent>
): Promise<PipelineEvent[]> {
  const events: PipelineEvent[] = [];
  for await (const event of iterator) {
    events.push(event);
  }
  return events;
}

describe("TranslationPipeline End-to-End", () => {
  describe("processAudio() with sample audio", () => {
    it("processes speech-like audio through full pipeline", async () => {
      const { pipeline } = await createTestPipeline();

      // Generate 1 second of speech-like audio
      const audio = generateSpeechLike(1000);

      const events = await collectEvents(
        pipeline.processAudio(audio, { sampleRate: SAMPLE_RATE, channels: 1 })
      );

      // Should have VAD, transcription, translation, and synthesis events
      const vadEvents = events.filter((e) => e.type === "vad");
      const transcriptionEvents = events.filter((e) => e.type === "transcription");
      const translationEvents = events.filter((e) => e.type === "translation");
      const synthesisEvents = events.filter((e) => e.type === "synthesis");

      expect(vadEvents.length).toBeGreaterThan(0);
      expect(transcriptionEvents.length).toBeGreaterThan(0);
      // Should have translations for all 3 languages
      expect(translationEvents.length).toBe(3);
      // Should have synthesis for all 3 languages
      expect(synthesisEvents.length).toBe(3);

      await pipeline.shutdown();
    });

    it("handles multiple audio chunks in streaming fashion", async () => {
      const { pipeline } = await createTestPipeline();

      // Generate 3 seconds of mixed audio
      const { samples } = generateLongMixedAudio(3000, 1000, 500);

      // Process in 500ms chunks (simulating real-time streaming)
      const chunkSize = Math.floor(SAMPLE_RATE * 0.5);
      const allEvents: PipelineEvent[] = [];

      for (let offset = 0; offset < samples.length; offset += chunkSize) {
        const chunk = samples.slice(offset, offset + chunkSize);
        const events = await collectEvents(
          pipeline.processAudio(chunk, { sampleRate: SAMPLE_RATE, channels: 1 })
        );
        allEvents.push(...events);
      }

      // Should have accumulated events from multiple chunks
      expect(allEvents.length).toBeGreaterThan(0);

      // At least some VAD events
      const vadEvents = allEvents.filter((e) => e.type === "vad");
      expect(vadEvents.length).toBeGreaterThan(0);

      await pipeline.shutdown();
    });

    it("extracts correct segment audio from accumulated buffer", async () => {
      const { pipeline } = await createTestPipeline();

      // Process two 500ms chunks
      const chunk1 = generateSpeechLike(500);
      const chunk2 = generateSpeechLike(500);

      // First chunk
      const events1 = await collectEvents(
        pipeline.processAudio(chunk1, { sampleRate: SAMPLE_RATE, channels: 1 })
      );

      // Second chunk
      const events2 = await collectEvents(
        pipeline.processAudio(chunk2, { sampleRate: SAMPLE_RATE, channels: 1 })
      );

      // Both should produce VAD events
      const vadEvents1 = events1.filter((e) => e.type === "vad");
      const vadEvents2 = events2.filter((e) => e.type === "vad");

      expect(vadEvents1.length).toBeGreaterThan(0);
      expect(vadEvents2.length).toBeGreaterThan(0);

      // The second chunk's segment should have correct timing
      // (not sliced from empty buffer due to absolute timestamp bug)
      for (const event of vadEvents2) {
        if (event.type === "vad" && event.audio) {
          // Audio should not be empty - this verifies the accumulator fix
          expect(event.audio.length).toBeGreaterThan(0);
        }
      }

      await pipeline.shutdown();
    });
  });

  describe("fire-and-forget language isolation", () => {
    it("continues processing when one language fails translation", async () => {
      const { pipeline } = await createTestPipeline({
        translationOptions: {
          failingLanguages: ["zh"], // Chinese will fail
        },
      });

      const audio = generateSpeechLike(500);
      const events = await collectEvents(
        pipeline.processAudio(audio, { sampleRate: SAMPLE_RATE, channels: 1 })
      );

      // Should have translation events for es and ko
      const translationEvents = events.filter((e) => e.type === "translation");
      const esTranslation = translationEvents.find(
        (e) => e.type === "translation" && e.targetLanguage === "es"
      );
      const koTranslation = translationEvents.find(
        (e) => e.type === "translation" && e.targetLanguage === "ko"
      );

      expect(esTranslation).toBeDefined();
      expect(koTranslation).toBeDefined();

      // Should have error event for zh
      const errorEvents = events.filter((e) => e.type === "error");
      const zhError = errorEvents.find(
        (e) => e.type === "error" && e.targetLanguage === "zh"
      );
      expect(zhError).toBeDefined();
      expect(zhError?.recoverable).toBe(true);

      await pipeline.shutdown();
    });

    it("continues processing when one language fails TTS", async () => {
      const { pipeline } = await createTestPipeline({
        ttsOptions: {
          failingLanguages: ["ko"], // Korean TTS will fail
        },
      });

      const audio = generateSpeechLike(500);
      const events = await collectEvents(
        pipeline.processAudio(audio, { sampleRate: SAMPLE_RATE, channels: 1 })
      );

      // Should have synthesis events for es and zh
      const synthesisEvents = events.filter((e) => e.type === "synthesis");
      const esSynthesis = synthesisEvents.find(
        (e) => e.type === "synthesis" && e.targetLanguage === "es"
      );
      const zhSynthesis = synthesisEvents.find(
        (e) => e.type === "synthesis" && e.targetLanguage === "zh"
      );

      expect(esSynthesis).toBeDefined();
      expect(zhSynthesis).toBeDefined();

      // Should have error event for ko
      const errorEvents = events.filter((e) => e.type === "error");
      const koError = errorEvents.find(
        (e) => e.type === "error" && e.targetLanguage === "ko"
      );
      expect(koError).toBeDefined();

      await pipeline.shutdown();
    });

    it("handles multiple language failures gracefully", async () => {
      const { pipeline } = await createTestPipeline({
        translationOptions: {
          failingLanguages: ["es", "ko"], // Two languages fail
        },
      });

      const audio = generateSpeechLike(500);
      const events = await collectEvents(
        pipeline.processAudio(audio, { sampleRate: SAMPLE_RATE, channels: 1 })
      );

      // Should still have translation for zh
      const translationEvents = events.filter((e) => e.type === "translation");
      const zhTranslation = translationEvents.find(
        (e) => e.type === "translation" && e.targetLanguage === "zh"
      );
      expect(zhTranslation).toBeDefined();

      // Should have errors for es and ko
      const errorEvents = events.filter((e) => e.type === "error");
      expect(errorEvents.length).toBeGreaterThanOrEqual(2);

      await pipeline.shutdown();
    });
  });

  describe("latency benchmarking", () => {
    it("records end-to-end latency within target threshold", async () => {
      const { pipeline } = await createTestPipeline({
        // Add small latencies to simulate realistic timing
        vadOptions: { latencyMs: 10 },
        asrOptions: { latencyMs: 20 },
        translationOptions: { latencyMs: 15 },
        ttsOptions: { latencyMs: 25 },
      });

      const audio = generateSpeechLike(500);

      const startTime = Date.now();
      await collectEvents(
        pipeline.processAudio(audio, { sampleRate: SAMPLE_RATE, channels: 1 })
      );
      const endTime = Date.now();

      const totalLatency = endTime - startTime;

      // With mocked services, total should be under 500ms even with simulated latencies
      expect(totalLatency).toBeLessThan(500);

      // Check metrics recorded latency
      const metrics = pipeline.getMetrics();
      const snapshot = metrics.getSnapshot();

      expect(snapshot.latency.vad).toBeGreaterThan(0);
      expect(snapshot.latency.asr).toBeGreaterThan(0);

      // Benchmark assertions - latency targets from Phase 5 spec
      // Target: <4s end-to-end (with mocks, should be well under)
      expect(totalLatency).toBeLessThan(4000);

      await pipeline.shutdown();
    });

    it("tracks per-language translation and synthesis latency", async () => {
      const { pipeline } = await createTestPipeline({
        translationOptions: { latencyMs: 10 },
        ttsOptions: { latencyMs: 20 },
      });

      const audio = generateSpeechLike(500);
      await collectEvents(
        pipeline.processAudio(audio, { sampleRate: SAMPLE_RATE, channels: 1 })
      );

      const metrics = pipeline.getMetrics();
      const snapshot = metrics.getSnapshot();

      // All languages should have latency recorded
      expect(snapshot.latency.translation.es).toBeGreaterThan(0);
      expect(snapshot.latency.translation.zh).toBeGreaterThan(0);
      expect(snapshot.latency.translation.ko).toBeGreaterThan(0);

      expect(snapshot.latency.synthesis.es).toBeGreaterThan(0);
      expect(snapshot.latency.synthesis.zh).toBeGreaterThan(0);
      expect(snapshot.latency.synthesis.ko).toBeGreaterThan(0);

      await pipeline.shutdown();
    });
  });

  describe("memory tracking", () => {
    it("reports memory usage during processing", async () => {
      const { pipeline } = await createTestPipeline();

      // Get baseline memory
      const metricsBefore = pipeline.getMetrics();
      const snapshotBefore = metricsBefore.getSnapshot();
      const memoryBefore = snapshotBefore.memoryMB;

      // Process some audio
      const audio = generateSpeechLike(2000);
      await collectEvents(
        pipeline.processAudio(audio, { sampleRate: SAMPLE_RATE, channels: 1 })
      );

      const metricsAfter = pipeline.getMetrics();
      const snapshotAfter = metricsAfter.getSnapshot();
      const memoryAfter = snapshotAfter.memoryMB;

      // Memory should be reported and reasonable
      expect(memoryBefore).toBeGreaterThan(0);
      expect(memoryAfter).toBeGreaterThan(0);

      // Verify we're under the 10GB target from Phase 5 spec
      // (should be well under with mocks)
      expect(memoryAfter).toBeLessThan(10000);

      await pipeline.shutdown();
    });
  });

  describe("pipeline lifecycle", () => {
    it("can reset and process new session", async () => {
      const { pipeline } = await createTestPipeline();

      // First session
      const audio1 = generateSpeechLike(500);
      const events1 = await collectEvents(
        pipeline.processAudio(audio1, { sampleRate: SAMPLE_RATE, channels: 1 })
      );
      expect(events1.length).toBeGreaterThan(0);

      // Reset
      pipeline.reset();

      // Second session
      const audio2 = generateSpeechLike(500);
      const events2 = await collectEvents(
        pipeline.processAudio(audio2, { sampleRate: SAMPLE_RATE, channels: 1 })
      );
      expect(events2.length).toBeGreaterThan(0);

      await pipeline.shutdown();
    });

    it("rejects operations after shutdown", async () => {
      const { pipeline } = await createTestPipeline();

      await pipeline.shutdown();

      const audio = generateSpeechLike(500);

      // Should throw after shutdown
      await expect(async () => {
        for await (const _ of pipeline.processAudio(audio)) {
          // Should not reach here
        }
      }).rejects.toThrow();
    });
  });

  describe("event correctness", () => {
    it("emits events in correct order: vad → transcription → translation → synthesis", async () => {
      const { pipeline } = await createTestPipeline();

      const audio = generateSpeechLike(500);
      const events = await collectEvents(
        pipeline.processAudio(audio, { sampleRate: SAMPLE_RATE, channels: 1 })
      );

      // Find first occurrence of each event type
      const firstVad = events.findIndex((e) => e.type === "vad");
      const firstTranscription = events.findIndex((e) => e.type === "transcription");
      const firstTranslation = events.findIndex((e) => e.type === "translation");
      const firstSynthesis = events.findIndex((e) => e.type === "synthesis");

      // VAD should come before transcription
      expect(firstVad).toBeLessThan(firstTranscription);

      // Transcription should come before translation
      expect(firstTranscription).toBeLessThan(firstTranslation);

      // Translation should come before synthesis
      expect(firstTranslation).toBeLessThan(firstSynthesis);

      await pipeline.shutdown();
    });

    it("includes segment audio in VAD events", async () => {
      const { pipeline } = await createTestPipeline();

      const audio = generateSpeechLike(500);
      const events = await collectEvents(
        pipeline.processAudio(audio, { sampleRate: SAMPLE_RATE, channels: 1 })
      );

      const vadEvents = events.filter((e) => e.type === "vad" && !e.isPartial);

      for (const event of vadEvents) {
        if (event.type === "vad") {
          // Non-partial VAD events should include audio
          expect(event.audio).toBeDefined();
          expect(event.audio?.length).toBeGreaterThan(0);
        }
      }

      await pipeline.shutdown();
    });

    it("includes synthesized audio in synthesis events", async () => {
      const { pipeline } = await createTestPipeline();

      const audio = generateSpeechLike(500);
      const events = await collectEvents(
        pipeline.processAudio(audio, { sampleRate: SAMPLE_RATE, channels: 1 })
      );

      const synthesisEvents = events.filter((e) => e.type === "synthesis");

      for (const event of synthesisEvents) {
        if (event.type === "synthesis") {
          expect(event.result).toBeDefined();
          expect(event.result.audio).toBeDefined();
          expect(event.result.audio.length).toBeGreaterThan(0);
          expect(event.result.sampleRate).toBeGreaterThan(0);
          expect(event.result.duration).toBeGreaterThan(0);
        }
      }

      await pipeline.shutdown();
    });
  });
});
