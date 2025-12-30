/**
 * Metrics collection and reporting for the Translation Pipeline.
 * Tracks per-stage latency, per-language success/failure, and memory usage.
 */

import {
  type TargetLanguage,
  type LanguageStatus,
  type LatencyMetrics,
  type PerLanguageLatency,
  type MetricsPipelineEvent,
  TARGET_LANGUAGES,
  getTimestamp,
} from "./PipelineTypes.js";

/**
 * Configuration for metrics collection.
 */
export interface PipelineMetricsConfig {
  /** Latency threshold in milliseconds for alerting */
  readonly latencyThresholdMs: number;
  /** Memory threshold in megabytes for alerting */
  readonly memoryThresholdMB: number;
}

/**
 * Stage timing for a single operation.
 */
interface StageTiming {
  startTime: number;
  endTime: number | null;
}

/**
 * Per-language timing tracking.
 */
interface LanguageTiming {
  translation: StageTiming | null;
  synthesis: StageTiming | null;
}

/**
 * Snapshot of metrics at a point in time.
 */
export interface MetricsSnapshot {
  readonly timestamp: number;
  readonly latency: LatencyMetrics;
  readonly memoryMB: number;
  readonly languageStatus: ReadonlyMap<TargetLanguage, LanguageStatus>;
  readonly thresholdViolation: boolean;
  readonly violations: readonly ThresholdViolation[];
}

/**
 * Details about a threshold violation.
 */
export interface ThresholdViolation {
  readonly type: "latency" | "memory";
  readonly value: number;
  readonly threshold: number;
  readonly language?: TargetLanguage;
}

/**
 * Collects and manages pipeline performance metrics.
 *
 * Thread-safe for concurrent updates from multiple language workers.
 * Provides snapshot-based access to avoid race conditions.
 */
export class PipelineMetrics {
  private readonly latencyThresholdMs: number;
  private readonly memoryThresholdMB: number;

  // Stage timing for current operation
  private vadTiming: StageTiming | null = null;
  private asrTiming: StageTiming | null = null;
  private languageTimings: Map<TargetLanguage, LanguageTiming> = new Map();
  private operationStartTime: number | null = null;

  // Historical metrics for averaging
  private readonly recentLatencies: LatencyMetrics[] = [];
  private readonly maxHistorySize = 100;

  // Per-language status
  private readonly languageStatusMap: Map<TargetLanguage, LanguageStatus> =
    new Map();

  constructor(config: Readonly<PipelineMetricsConfig>) {
    this.latencyThresholdMs = config.latencyThresholdMs;
    this.memoryThresholdMB = config.memoryThresholdMB;

    // Initialize language status for all target languages
    for (const lang of TARGET_LANGUAGES) {
      this.languageStatusMap.set(lang, {
        language: lang,
        isActive: true,
        lastSuccessTimestamp: null,
        lastErrorTimestamp: null,
        errorCount: 0,
        successCount: 0,
      });

      this.languageTimings.set(lang, {
        translation: null,
        synthesis: null,
      });
    }
  }

  /**
   * Start tracking a new pipeline operation.
   */
  startOperation(): void {
    this.operationStartTime = getTimestamp();
    this.vadTiming = null;
    this.asrTiming = null;

    for (const lang of TARGET_LANGUAGES) {
      this.languageTimings.set(lang, {
        translation: null,
        synthesis: null,
      });
    }
  }

  /**
   * Record the start of VAD processing.
   */
  startVAD(): void {
    this.vadTiming = { startTime: getTimestamp(), endTime: null };
  }

  /**
   * Record the end of VAD processing.
   */
  endVAD(): void {
    if (this.vadTiming) {
      this.vadTiming.endTime = getTimestamp();
    }
  }

  /**
   * Record the start of ASR processing.
   */
  startASR(): void {
    this.asrTiming = { startTime: getTimestamp(), endTime: null };
  }

  /**
   * Record the end of ASR processing.
   */
  endASR(): void {
    if (this.asrTiming) {
      this.asrTiming.endTime = getTimestamp();
    }
  }

  /**
   * Record the start of translation for a language.
   */
  startTranslation(language: TargetLanguage): void {
    const timing = this.languageTimings.get(language);
    if (timing) {
      timing.translation = { startTime: getTimestamp(), endTime: null };
    }
  }

  /**
   * Record the end of translation for a language.
   */
  endTranslation(language: TargetLanguage, success: boolean): void {
    const timing = this.languageTimings.get(language);
    if (timing?.translation) {
      timing.translation.endTime = getTimestamp();
    }

    this.updateLanguageStatus(language, success, "translation");
  }

  /**
   * Record the start of synthesis for a language.
   */
  startSynthesis(language: TargetLanguage): void {
    const timing = this.languageTimings.get(language);
    if (timing) {
      timing.synthesis = { startTime: getTimestamp(), endTime: null };
    }
  }

  /**
   * Record the end of synthesis for a language.
   */
  endSynthesis(language: TargetLanguage, success: boolean): void {
    const timing = this.languageTimings.get(language);
    if (timing?.synthesis) {
      timing.synthesis.endTime = getTimestamp();
    }

    this.updateLanguageStatus(language, success, "synthesis");
  }

  /**
   * Finalize the current operation and store latency metrics.
   */
  finalizeOperation(): void {
    const latency = this.calculateCurrentLatency();
    this.recentLatencies.push(latency);

    // Keep only recent history
    while (this.recentLatencies.length > this.maxHistorySize) {
      this.recentLatencies.shift();
    }

    this.operationStartTime = null;
  }

  /**
   * Get a snapshot of current metrics.
   */
  getSnapshot(): MetricsSnapshot {
    const latency = this.calculateCurrentLatency();
    const memoryMB = this.getCurrentMemoryMB();
    const violations = this.checkThresholds(latency, memoryMB);

    return {
      timestamp: getTimestamp(),
      latency,
      memoryMB,
      languageStatus: new Map(this.languageStatusMap),
      thresholdViolation: violations.length > 0,
      violations,
    };
  }

  /**
   * Get average latency metrics over recent operations.
   */
  getAverageLatency(): LatencyMetrics {
    if (this.recentLatencies.length === 0) {
      return this.createEmptyLatencyMetrics();
    }

    const count = this.recentLatencies.length;
    const sum = this.recentLatencies.reduce(
      (acc, curr) => ({
        vad: acc.vad + curr.vad,
        asr: acc.asr + curr.asr,
        translation: {
          es: acc.translation.es + curr.translation.es,
          zh: acc.translation.zh + curr.translation.zh,
          ko: acc.translation.ko + curr.translation.ko,
        },
        synthesis: {
          es: acc.synthesis.es + curr.synthesis.es,
          zh: acc.synthesis.zh + curr.synthesis.zh,
          ko: acc.synthesis.ko + curr.synthesis.ko,
        },
        total: acc.total + curr.total,
      }),
      this.createEmptyLatencyMetrics()
    );

    return {
      vad: sum.vad / count,
      asr: sum.asr / count,
      translation: {
        es: sum.translation.es / count,
        zh: sum.translation.zh / count,
        ko: sum.translation.ko / count,
      },
      synthesis: {
        es: sum.synthesis.es / count,
        zh: sum.synthesis.zh / count,
        ko: sum.synthesis.ko / count,
      },
      total: sum.total / count,
    };
  }

  /**
   * Get the status of a specific language.
   */
  getLanguageStatus(language: TargetLanguage): LanguageStatus | undefined {
    return this.languageStatusMap.get(language);
  }

  /**
   * Mark a language as inactive (e.g., after repeated failures).
   */
  setLanguageActive(language: TargetLanguage, active: boolean): void {
    const current = this.languageStatusMap.get(language);
    if (current) {
      this.languageStatusMap.set(language, {
        ...current,
        isActive: active,
      });
    }
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this.recentLatencies.length = 0;
    this.operationStartTime = null;
    this.vadTiming = null;
    this.asrTiming = null;

    for (const lang of TARGET_LANGUAGES) {
      this.languageStatusMap.set(lang, {
        language: lang,
        isActive: true,
        lastSuccessTimestamp: null,
        lastErrorTimestamp: null,
        errorCount: 0,
        successCount: 0,
      });

      this.languageTimings.set(lang, {
        translation: null,
        synthesis: null,
      });
    }
  }

  /**
   * Create a metrics event for emission.
   */
  createMetricsEvent(): MetricsPipelineEvent {
    const snapshot = this.getSnapshot();
    return {
      type: "metrics",
      timestamp: snapshot.timestamp,
      latencyMs: snapshot.latency,
      memoryMB: snapshot.memoryMB,
      languageStatus: snapshot.languageStatus,
      thresholdViolation: snapshot.thresholdViolation,
    };
  }

  /**
   * Calculate latency for the current operation.
   */
  private calculateCurrentLatency(): LatencyMetrics {
    const vadLatency = this.calculateStageDuration(this.vadTiming);
    const asrLatency = this.calculateStageDuration(this.asrTiming);

    const translationLatency: PerLanguageLatency = {
      es: this.calculateLanguageStageLatency("es", "translation"),
      zh: this.calculateLanguageStageLatency("zh", "translation"),
      ko: this.calculateLanguageStageLatency("ko", "translation"),
    };

    const synthesisLatency: PerLanguageLatency = {
      es: this.calculateLanguageStageLatency("es", "synthesis"),
      zh: this.calculateLanguageStageLatency("zh", "synthesis"),
      ko: this.calculateLanguageStageLatency("ko", "synthesis"),
    };

    // Total is from operation start to now (or last completed stage)
    const now = getTimestamp();
    const total = this.operationStartTime
      ? now - this.operationStartTime
      : vadLatency +
        asrLatency +
        Math.max(...Object.values(translationLatency)) +
        Math.max(...Object.values(synthesisLatency));

    return {
      vad: vadLatency,
      asr: asrLatency,
      translation: translationLatency,
      synthesis: synthesisLatency,
      total,
    };
  }

  /**
   * Calculate duration for a single stage.
   */
  private calculateStageDuration(timing: StageTiming | null): number {
    if (!timing) {
      return 0;
    }
    const endTime = timing.endTime ?? getTimestamp();
    return endTime - timing.startTime;
  }

  /**
   * Calculate latency for a language-specific stage.
   */
  private calculateLanguageStageLatency(
    language: TargetLanguage,
    stage: "translation" | "synthesis"
  ): number {
    const timing = this.languageTimings.get(language);
    if (!timing) {
      return 0;
    }
    return this.calculateStageDuration(timing[stage]);
  }

  /**
   * Update the status for a language after a stage completes.
   */
  private updateLanguageStatus(
    language: TargetLanguage,
    success: boolean,
    _stage: "translation" | "synthesis"
  ): void {
    const current = this.languageStatusMap.get(language);
    if (!current) {
      return;
    }

    const now = getTimestamp();
    this.languageStatusMap.set(language, {
      ...current,
      lastSuccessTimestamp: success ? now : current.lastSuccessTimestamp,
      lastErrorTimestamp: success ? current.lastErrorTimestamp : now,
      errorCount: success ? current.errorCount : current.errorCount + 1,
      successCount: success ? current.successCount + 1 : current.successCount,
    });
  }

  /**
   * Get current memory usage in MB.
   */
  private getCurrentMemoryMB(): number {
    const usage = process.memoryUsage();
    // Use RSS (Resident Set Size) for total memory footprint
    return usage.rss / (1024 * 1024);
  }

  /**
   * Check if any thresholds are violated.
   */
  private checkThresholds(
    latency: LatencyMetrics,
    memoryMB: number
  ): ThresholdViolation[] {
    const violations: ThresholdViolation[] = [];

    // Check total latency
    if (latency.total > this.latencyThresholdMs) {
      violations.push({
        type: "latency",
        value: latency.total,
        threshold: this.latencyThresholdMs,
      });
    }

    // Check per-language latencies
    for (const lang of TARGET_LANGUAGES) {
      const langTotal =
        latency.translation[lang] + latency.synthesis[lang];
      if (langTotal > this.latencyThresholdMs) {
        violations.push({
          type: "latency",
          value: langTotal,
          threshold: this.latencyThresholdMs,
          language: lang,
        });
      }
    }

    // Check memory
    if (memoryMB > this.memoryThresholdMB) {
      violations.push({
        type: "memory",
        value: memoryMB,
        threshold: this.memoryThresholdMB,
      });
    }

    return violations;
  }

  /**
   * Create empty latency metrics for initialization.
   */
  private createEmptyLatencyMetrics(): LatencyMetrics {
    return {
      vad: 0,
      asr: 0,
      translation: { es: 0, zh: 0, ko: 0 },
      synthesis: { es: 0, zh: 0, ko: 0 },
      total: 0,
    };
  }
}

/**
 * Create a new PipelineMetrics instance.
 */
export function createPipelineMetrics(
  config: Readonly<PipelineMetricsConfig>
): PipelineMetrics {
  return new PipelineMetrics(config);
}
