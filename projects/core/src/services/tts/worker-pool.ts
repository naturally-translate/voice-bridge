/**
 * TTS worker pool manager.
 *
 * Manages three worker threads, one per target language (es, zh, ko).
 * Provides task queuing with backpressure and fire-and-forget per-language isolation.
 */
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { TTSResult } from "../../interfaces/ITTS.js";
import {
  TTSWorkerError,
  TTSQueueFullError,
  TTSTimeoutError,
  TTSCancelledError,
} from "../../errors/TTSError.js";
import type {
  TTSWorkerInitData,
  TTSWorkerMessage,
  TTSWorkerResponse,
  SerializedEmbedding,
  TTSSynthesizeMessage,
} from "./tts.worker.js";
import type { SpeakerEmbedding } from "./XTTSClient.js";

/**
 * Supported target languages for the TTS worker pool.
 */
const TTS_TARGET_LANGUAGES = ["es", "zh", "ko"] as const;
export type TTSTargetLanguage = (typeof TTS_TARGET_LANGUAGES)[number];

/**
 * Task in the queue.
 */
interface TTSTask {
  readonly id: string;
  readonly text: string;
  readonly embedding?: SpeakerEmbedding | undefined;
  readonly speed?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly fallbackToNeutral?: boolean | undefined;
  readonly resolve: (result: TTSResult) => void;
  readonly reject: (error: Error) => void;
}

/**
 * Pending task being processed by the worker.
 */
interface PendingTask {
  readonly id: string;
  readonly resolve: (result: TTSResult) => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal | undefined;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

/**
 * Worker state including the worker instance, queue, and pending task.
 */
interface WorkerState {
  worker: Worker;
  readonly language: TTSTargetLanguage;
  readonly queue: TTSTask[];
  currentTask: PendingTask | null;
  isReady: boolean;
  restartCount: number;
}

/**
 * Default configuration values.
 */
const DEFAULT_MAX_QUEUE_SIZE = 50;
const DEFAULT_TASK_TIMEOUT_MS = 60000; // 60 seconds (TTS can be slow)
const DEFAULT_MAX_RESTART_ATTEMPTS = 3;
const DEFAULT_RESTART_DELAY_MS = 2000; // 2 seconds

export interface TTSWorkerPoolOptions {
  /** XTTS server URL. Default: http://localhost:8000 */
  readonly serverUrl?: string;
  /** Maximum queue size per worker. Rejects new tasks when exceeded. Default: 50 */
  readonly maxQueueSize?: number;
  /** Timeout for individual TTS tasks in milliseconds. Default: 60000 (60s) */
  readonly taskTimeoutMs?: number;
  /** Maximum number of restart attempts per worker. Default: 3 */
  readonly maxRestartAttempts?: number;
  /** Delay between restart attempts in milliseconds. Default: 2000 (2s) */
  readonly restartDelayMs?: number;
}

/**
 * Options for TTS requests.
 */
export interface TTSRequestOptions {
  /** Speaker embedding for voice cloning. If not provided, uses neutral voice. */
  readonly embedding?: SpeakerEmbedding;
  /** Speech speed multiplier (0.5 to 2.0). Default: 1.0 */
  readonly speed?: number;
  /** AbortSignal to cancel the request */
  readonly signal?: AbortSignal;
  /**
   * If true, retry synthesis without embedding when embedding-based synthesis fails.
   * This provides a fallback to neutral voice when voice cloning fails.
   * Default: false
   */
  readonly fallbackToNeutral?: boolean;
}

/**
 * Manages a pool of TTS worker threads.
 *
 * Each worker handles a single target language for isolation.
 * Tasks are queued per worker and processed one at a time (backpressure).
 * Worker failures do not affect other languages (fire-and-forget isolation).
 */
export class TTSWorkerPool {
  private readonly serverUrl: string;
  private readonly maxQueueSize: number;
  private readonly taskTimeoutMs: number;
  private readonly maxRestartAttempts: number;
  private readonly restartDelayMs: number;
  private readonly workers: Map<TTSTargetLanguage, WorkerState> = new Map();
  private taskIdCounter = 0;
  private isInitialized = false;

  constructor(options?: Readonly<TTSWorkerPoolOptions>) {
    this.serverUrl = options?.serverUrl ?? "http://localhost:8000";
    this.maxQueueSize = options?.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.taskTimeoutMs = options?.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
    this.maxRestartAttempts =
      options?.maxRestartAttempts ?? DEFAULT_MAX_RESTART_ATTEMPTS;
    this.restartDelayMs = options?.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS;
  }

  get isReady(): boolean {
    return this.isInitialized;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const workerPath = this.getWorkerPath();

    // Create and initialize all workers in parallel
    const initPromises = TTS_TARGET_LANGUAGES.map((language) =>
      this.initializeWorker(language, workerPath)
    );

    await Promise.all(initPromises);
    this.isInitialized = true;
  }

  /**
   * Synthesize text to speech for a specific target language.
   * Queues the request and processes with backpressure (one at a time).
   *
   * @throws {TTSQueueFullError} When the queue exceeds maxQueueSize
   * @throws {TTSTimeoutError} When the request times out
   * @throws {TTSCancelledError} When the request is cancelled via signal
   */
  async synthesize(
    text: string,
    targetLanguage: TTSTargetLanguage,
    options?: Readonly<TTSRequestOptions>
  ): Promise<TTSResult> {
    const workerState = this.workers.get(targetLanguage);
    if (!workerState) {
      throw new TTSWorkerError(
        `No worker available for language: ${targetLanguage}`,
        targetLanguage
      );
    }

    if (!workerState.isReady) {
      throw new TTSWorkerError(
        `Worker for ${targetLanguage} is not ready`,
        targetLanguage
      );
    }

    // Check if already cancelled
    if (options?.signal?.aborted) {
      throw new TTSCancelledError(targetLanguage);
    }

    // Check queue bounds
    const currentQueueLength = this.getQueueLength(targetLanguage);
    if (currentQueueLength >= this.maxQueueSize) {
      throw new TTSQueueFullError(targetLanguage, currentQueueLength);
    }

    return this.enqueueTask(workerState, text, options);
  }

  /**
   * Synthesize text to all supported target languages in parallel.
   * Returns results for all languages, with individual failures not blocking others.
   */
  async synthesizeAll(
    text: string,
    options?: Readonly<TTSRequestOptions>
  ): Promise<Map<TTSTargetLanguage, TTSResult | Error>> {
    const results = new Map<TTSTargetLanguage, TTSResult | Error>();

    const promises = TTS_TARGET_LANGUAGES.map(async (language) => {
      try {
        const result = await this.synthesize(text, language, options);
        results.set(language, result);
      } catch (error) {
        results.set(
          language,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * Shuts down all workers gracefully.
   */
  async shutdown(): Promise<void> {
    const shutdownPromises = Array.from(this.workers.values()).map(
      (workerState) => this.shutdownWorker(workerState)
    );

    await Promise.all(shutdownPromises);
    this.workers.clear();
    this.isInitialized = false;
  }

  /**
   * Gets the supported target languages.
   */
  getSupportedLanguages(): readonly TTSTargetLanguage[] {
    return TTS_TARGET_LANGUAGES;
  }

  /**
   * Gets the current queue length for a specific language.
   * Useful for monitoring backpressure.
   */
  getQueueLength(targetLanguage: TTSTargetLanguage): number {
    const workerState = this.workers.get(targetLanguage);
    if (!workerState) {
      return 0;
    }
    // Include current task in the count if present
    return workerState.queue.length + (workerState.currentTask ? 1 : 0);
  }

  protected getWorkerPath(): string {
    const thisFile = fileURLToPath(import.meta.url);
    const thisDir = dirname(thisFile);
    return join(thisDir, "tts.worker.js");
  }

  private async initializeWorker(
    language: TTSTargetLanguage,
    workerPath: string
  ): Promise<void> {
    const initData: TTSWorkerInitData = {
      serverUrl: this.serverUrl,
      targetLanguage: language,
      timeoutMs: this.taskTimeoutMs,
    };

    const worker = new Worker(workerPath, {
      workerData: initData,
    });

    const workerState: WorkerState = {
      worker,
      language,
      queue: [],
      currentTask: null,
      isReady: false,
      restartCount: 0,
    };

    this.workers.set(language, workerState);

    // Set up message handler
    worker.on("message", (response: TTSWorkerResponse) => {
      this.handleWorkerResponse(workerState, response);
    });

    // Set up error handler
    worker.on("error", (error: Error) => {
      this.handleWorkerError(workerState, error);
    });

    // Set up exit handler
    worker.on("exit", (code: number) => {
      if (code !== 0) {
        this.handleWorkerExit(workerState, code);
      }
    });

    // Send initialization message and wait for response
    await this.sendInitializeMessage(workerState);
  }

  private sendInitializeMessage(workerState: WorkerState): Promise<void> {
    return new Promise((resolve, reject) => {
      const id = this.generateTaskId();

      const pendingTask: PendingTask = {
        id,
        resolve: () => {
          (workerState as { isReady: boolean }).isReady = true;
          (workerState as { currentTask: PendingTask | null }).currentTask =
            null;
          resolve();
        },
        reject: (error) => {
          (workerState as { currentTask: PendingTask | null }).currentTask =
            null;
          reject(error);
        },
        timeoutId: null,
      };
      (workerState as { currentTask: PendingTask | null }).currentTask = pendingTask;

      const message: TTSWorkerMessage = {
        type: "initialize",
        id,
      };

      workerState.worker.postMessage(message);
    });
  }

  private enqueueTask(
    workerState: WorkerState,
    text: string,
    options?: Readonly<TTSRequestOptions>
  ): Promise<TTSResult> {
    return new Promise((resolve, reject) => {
      const id = this.generateTaskId();

      // Build task without undefined optional properties
      const task: TTSTask = {
        id,
        text,
        resolve,
        reject,
      };
      if (options?.embedding !== undefined) {
        (task as { embedding: typeof options.embedding }).embedding = options.embedding;
      }
      if (options?.speed !== undefined) {
        (task as { speed: number }).speed = options.speed;
      }
      if (options?.signal !== undefined) {
        (task as { signal: AbortSignal }).signal = options.signal;
      }
      if (options?.fallbackToNeutral !== undefined) {
        (task as { fallbackToNeutral: boolean }).fallbackToNeutral = options.fallbackToNeutral;
      }

      // Set up abort handler if signal provided
      if (options?.signal) {
        const abortHandler = () => {
          // Remove from queue if still pending
          const queueIndex = workerState.queue.findIndex((t) => t.id === id);
          if (queueIndex !== -1) {
            workerState.queue.splice(queueIndex, 1);
            reject(new TTSCancelledError(workerState.language));
          }
        };

        options.signal.addEventListener("abort", abortHandler, { once: true });
      }

      // Add to queue
      workerState.queue.push(task);

      // Try to process next task
      this.processNextTask(workerState);
    });
  }

  /**
   * Process the next task in the queue if worker is idle.
   */
  private processNextTask(workerState: WorkerState): void {
    // If already processing a task, wait
    if (workerState.currentTask) {
      return;
    }

    // Get next task from queue
    const task = workerState.queue.shift();
    if (!task) {
      return;
    }

    // Check if task was cancelled while in queue
    if (task.signal?.aborted) {
      task.reject(new TTSCancelledError(workerState.language));
      // Process next task
      this.processNextTask(workerState);
      return;
    }

    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (workerState.currentTask?.id === task.id) {
        (workerState as { currentTask: PendingTask | null }).currentTask = null;
        task.reject(
          new TTSTimeoutError(workerState.language, this.taskTimeoutMs)
        );
        this.processNextTask(workerState);
      }
    }, this.taskTimeoutMs);

    // Set as current task - build without undefined optional properties
    const pendingTask: PendingTask = {
      id: task.id,
      resolve: task.resolve,
      reject: task.reject,
      timeoutId,
    };
    if (task.signal !== undefined) {
      (pendingTask as { signal: AbortSignal }).signal = task.signal;
    }
    (workerState as { currentTask: PendingTask | null }).currentTask = pendingTask;

    // Serialize embedding for transfer if present
    let serializedEmbedding: SerializedEmbedding | undefined;
    if (task.embedding) {
      // Create a new ArrayBuffer to avoid SharedArrayBuffer issues
      const sourceBuffer = task.embedding.data.buffer;
      const embeddingBuffer = new ArrayBuffer(task.embedding.data.byteLength);
      new Uint8Array(embeddingBuffer).set(
        new Uint8Array(sourceBuffer, task.embedding.data.byteOffset, task.embedding.data.byteLength)
      );
      serializedEmbedding = {
        data: embeddingBuffer,
        shape: task.embedding.shape,
      };
    }

    // Send message to worker - build without undefined optional properties
    const message: TTSSynthesizeMessage = {
      type: "synthesize",
      id: task.id,
      text: task.text,
    };
    if (serializedEmbedding !== undefined) {
      (message as { embedding: SerializedEmbedding }).embedding = serializedEmbedding;
    }
    if (task.speed !== undefined) {
      (message as { speed: number }).speed = task.speed;
    }
    if (task.fallbackToNeutral !== undefined) {
      (message as { fallbackToNeutral: boolean }).fallbackToNeutral = task.fallbackToNeutral;
    }

    // Transfer embedding buffer if present for efficiency
    const transferList = serializedEmbedding
      ? [serializedEmbedding.data]
      : undefined;
    workerState.worker.postMessage(message, transferList);
  }

  private async shutdownWorker(workerState: WorkerState): Promise<void> {
    // Reject all pending queue tasks
    for (const task of workerState.queue) {
      task.reject(new TTSWorkerError("Worker shutting down", workerState.language));
    }
    workerState.queue.length = 0;

    return new Promise((resolve) => {
      const id = this.generateTaskId();

      const timeoutId = setTimeout(() => {
        if (workerState.currentTask) {
          workerState.currentTask.reject(
            new TTSWorkerError("Shutdown timeout", workerState.language)
          );
        }
        (workerState as { currentTask: PendingTask | null }).currentTask = null;
        void workerState.worker.terminate();
        resolve();
      }, 5000);

      const pendingTask: PendingTask = {
        id,
        resolve: () => {
          clearTimeout(timeoutId);
          (workerState as { currentTask: PendingTask | null }).currentTask =
            null;
          resolve();
        },
        reject: () => {
          clearTimeout(timeoutId);
          (workerState as { currentTask: PendingTask | null }).currentTask =
            null;
          resolve();
        },
        timeoutId: null,
      };
      (workerState as { currentTask: PendingTask | null }).currentTask = pendingTask;

      const message: TTSWorkerMessage = {
        type: "shutdown",
        id,
      };

      workerState.worker.postMessage(message);
    });
  }

  private clearTaskTimeout(task: PendingTask): void {
    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
    }
  }

  private handleWorkerResponse(
    workerState: WorkerState,
    response: TTSWorkerResponse
  ): void {
    const currentTask = workerState.currentTask;

    // Verify response matches current task
    if (!currentTask || currentTask.id !== response.id) {
      return;
    }

    switch (response.type) {
      case "initialized": {
        this.clearTaskTimeout(currentTask);
        // Resolve with a dummy TTSResult for initialization
        currentTask.resolve({
          audio: new Float32Array(0),
          sampleRate: 0,
          duration: 0,
        });
        break;
      }
      case "synthesized": {
        this.clearTaskTimeout(currentTask);
        (workerState as { currentTask: PendingTask | null }).currentTask = null;

        // Convert ArrayBuffer back to Float32Array
        const audio = new Float32Array(response.result.audio);

        currentTask.resolve({
          audio,
          sampleRate: response.result.sampleRate,
          duration: response.result.duration,
        });
        this.processNextTask(workerState);
        break;
      }
      case "error": {
        this.clearTaskTimeout(currentTask);
        (workerState as { currentTask: PendingTask | null }).currentTask = null;
        currentTask.reject(
          new TTSWorkerError(response.error, workerState.language)
        );
        this.processNextTask(workerState);
        break;
      }
      case "shutdown": {
        this.clearTaskTimeout(currentTask);
        currentTask.resolve({
          audio: new Float32Array(0),
          sampleRate: 0,
          duration: 0,
        });
        break;
      }
    }
  }

  private handleWorkerError(workerState: WorkerState, error: Error): void {
    // Reject current task if any
    if (workerState.currentTask) {
      this.clearTaskTimeout(workerState.currentTask);
      workerState.currentTask.reject(
        new TTSWorkerError(error.message, workerState.language)
      );
      (workerState as { currentTask: PendingTask | null }).currentTask = null;
    }

    // Reject all queued tasks
    for (const task of workerState.queue) {
      task.reject(new TTSWorkerError(error.message, workerState.language));
    }
    workerState.queue.length = 0;

    (workerState as { isReady: boolean }).isReady = false;
  }

  private handleWorkerExit(workerState: WorkerState, code: number): void {
    const errorMessage = `Worker exited with code ${code}`;

    // Reject current task if any
    if (workerState.currentTask) {
      this.clearTaskTimeout(workerState.currentTask);
      workerState.currentTask.reject(
        new TTSWorkerError(errorMessage, workerState.language)
      );
      (workerState as { currentTask: PendingTask | null }).currentTask = null;
    }

    (workerState as { isReady: boolean }).isReady = false;

    // Attempt restart if within limits and pool is still initialized
    if (
      this.isInitialized &&
      workerState.restartCount < this.maxRestartAttempts
    ) {
      setTimeout(() => {
        void this.restartWorker(workerState);
      }, this.restartDelayMs);
    } else {
      // No more restarts - reject all queued tasks
      for (const task of workerState.queue) {
        task.reject(new TTSWorkerError(errorMessage, workerState.language));
      }
      workerState.queue.length = 0;
    }
  }

  private async restartWorker(workerState: WorkerState): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    workerState.restartCount++;

    try {
      const workerPath = this.getWorkerPath();
      const initData: TTSWorkerInitData = {
        serverUrl: this.serverUrl,
        targetLanguage: workerState.language,
        timeoutMs: this.taskTimeoutMs,
      };

      const newWorker = new Worker(workerPath, {
        workerData: initData,
      });

      workerState.worker = newWorker;

      newWorker.on("message", (response: TTSWorkerResponse) => {
        this.handleWorkerResponse(workerState, response);
      });

      newWorker.on("error", (error: Error) => {
        this.handleWorkerError(workerState, error);
      });

      newWorker.on("exit", (code: number) => {
        if (code !== 0) {
          this.handleWorkerExit(workerState, code);
        }
      });

      await this.sendInitializeMessage(workerState);
      this.processNextTask(workerState);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      for (const task of workerState.queue) {
        task.reject(new TTSWorkerError(errorMessage, workerState.language));
      }
      workerState.queue.length = 0;
    }
  }

  private generateTaskId(): string {
    return `tts-task-${++this.taskIdCounter}`;
  }
}

/**
 * Create a new TTS worker pool instance.
 */
export function createTTSWorkerPool(
  options?: Readonly<TTSWorkerPoolOptions>
): TTSWorkerPool {
  return new TTSWorkerPool(options);
}
