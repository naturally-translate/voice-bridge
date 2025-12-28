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
