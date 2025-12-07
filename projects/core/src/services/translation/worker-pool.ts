/**
 * Translation worker pool manager.
 *
 * Manages three worker threads, one per target language (es, zh, ko).
 * Provides task queuing with backpressure and fire-and-forget per-language isolation.
 */
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { TranslationResult } from "../../interfaces/ITranslator.js";
import {
  WorkerError,
  QueueFullError,
  TranslationTimeoutError,
  TranslationCancelledError,
} from "../../errors/TranslationError.js";
import type {
  WorkerInitData,
  WorkerMessage,
  WorkerResponse,
} from "./translation.worker.js";

/**
 * Supported target languages for the worker pool.
 */
const TARGET_LANGUAGES = ["es", "zh", "ko"] as const;
export type TargetLanguage = (typeof TARGET_LANGUAGES)[number];

/**
 * Task types for the queue.
 */
type TaskType = "translate" | "translate-stream";

/**
 * Base task interface.
 */
interface BaseTask {
  readonly id: string;
  readonly type: TaskType;
  readonly text: string;
  readonly signal: AbortSignal | undefined;
}

/**
 * Single-shot translation task.
 */
interface TranslateTask extends BaseTask {
  readonly type: "translate";
  readonly resolve: (result: TranslationResult) => void;
  readonly reject: (error: Error) => void;
}

/**
 * Streaming translation task.
 */
interface TranslateStreamTask extends BaseTask {
  readonly type: "translate-stream";
  readonly onPartial: (result: TranslationResult) => void;
  readonly resolve: (result: TranslationResult) => void;
  readonly reject: (error: Error) => void;
}

type QueuedTask = TranslateTask | TranslateStreamTask;

/**
 * Pending task being processed by the worker.
 */
interface PendingTask {
  readonly id: string;
  readonly type: TaskType;
  readonly resolve: (result: TranslationResult) => void;
  readonly reject: (error: Error) => void;
  readonly onPartial: ((result: TranslationResult) => void) | undefined;
  readonly signal: AbortSignal | undefined;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

/**
 * Worker state including the worker instance, queue, and pending task.
 */
interface WorkerState {
  worker: Worker;
  readonly language: TargetLanguage;
  /** Queue of tasks waiting to be processed */
  readonly queue: QueuedTask[];
  /** Currently processing task (only one at a time for backpressure) */
  currentTask: PendingTask | null;
  isReady: boolean;
  /** Number of times this worker has been restarted */
  restartCount: number;
}

/**
 * Default configuration values.
 */
const DEFAULT_MAX_QUEUE_SIZE = 100;
const DEFAULT_TASK_TIMEOUT_MS = 30000; // 30 seconds
const DEFAULT_MAX_RESTART_ATTEMPTS = 3;
const DEFAULT_RESTART_DELAY_MS = 1000; // 1 second

export interface TranslationWorkerPoolOptions {
  readonly cacheDir?: string;
  /** Maximum queue size per worker. Rejects new tasks when exceeded. Default: 100 */
  readonly maxQueueSize?: number;
  /** Timeout for individual translation tasks in milliseconds. Default: 30000 (30s) */
  readonly taskTimeoutMs?: number;
  /** Maximum number of restart attempts per worker. Default: 3 */
  readonly maxRestartAttempts?: number;
  /** Delay between restart attempts in milliseconds. Default: 1000 (1s) */
  readonly restartDelayMs?: number;
}

/**
 * Options for translation requests.
 */
export interface TranslateOptions {
  /** AbortSignal to cancel the translation request */
  readonly signal?: AbortSignal;
}

/**
 * Manages a pool of translation worker threads.
 *
 * Each worker handles a single target language for isolation.
 * Tasks are queued per worker and processed one at a time (backpressure).
 * Worker failures do not affect other languages (fire-and-forget isolation).
 */
export class TranslationWorkerPool {
  private readonly cacheDir: string | null;
  private readonly maxQueueSize: number;
  private readonly taskTimeoutMs: number;
  private readonly maxRestartAttempts: number;
  private readonly restartDelayMs: number;
  private readonly workers: Map<TargetLanguage, WorkerState> = new Map();
  private taskIdCounter = 0;
  private isInitialized = false;

  constructor(options?: Readonly<TranslationWorkerPoolOptions>) {
    this.cacheDir = options?.cacheDir ?? null;
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

    // Get the path to the worker script
    const workerPath = this.getWorkerPath();

    // Create and initialize all workers in parallel
    const initPromises = TARGET_LANGUAGES.map((language) =>
      this.initializeWorker(language, workerPath)
    );

    await Promise.all(initPromises);
    this.isInitialized = true;
  }

/**
 * Translates text to a specific target language.
 * Queues the request and processes with backpressure (one at a time).
 *
 * @throws {QueueFullError} When the queue exceeds maxQueueSize
 * @throws {TranslationTimeoutError} When the request times out
 * @throws {TranslationCancelledError} When the request is cancelled via signal
 */
  async translate(
    text: string,
    targetLanguage: TargetLanguage,
    options?: Readonly<TranslateOptions>
  ): Promise<TranslationResult> {
    const workerState = this.workers.get(targetLanguage);
    if (!workerState) {
      throw new WorkerError(
        `No worker available for language: ${targetLanguage}`,
        targetLanguage
      );
    }

    if (!workerState.isReady) {
      throw new WorkerError(
        `Worker for ${targetLanguage} is not ready`,
        targetLanguage
      );
    }

    // Check if already cancelled
    if (options?.signal?.aborted) {
      throw new TranslationCancelledError(targetLanguage);
    }

    // Check queue bounds
    const currentQueueLength = this.getQueueLength(targetLanguage);
    if (currentQueueLength >= this.maxQueueSize) {
      throw new QueueFullError(targetLanguage, currentQueueLength);
    }

    return this.enqueueTranslateTask(workerState, text, options?.signal);
  }

  /**
   * Streaming translation that yields partial results.
   * Queues the request and processes with backpressure.
   *
   * NOTE: Uses sentence-level batching, not token-level streaming.
   * Text is split into sentences; each sentence translates as a unit.
   * Partial results accumulate progressively as sentences complete.
   *
   * @yields {TranslationResult} Partial translation results followed by final result
   * @throws {QueueFullError} When the queue exceeds maxQueueSize
   * @throws {TranslationTimeoutError} When the request times out
   * @throws {TranslationCancelledError} When the request is cancelled via signal
   */
  async *translateStream(
    text: string,
    targetLanguage: TargetLanguage,
    options?: Readonly<TranslateOptions>
  ): AsyncIterableIterator<TranslationResult> {
    const workerState = this.workers.get(targetLanguage);
    if (!workerState) {
      throw new WorkerError(
        `No worker available for language: ${targetLanguage}`,
        targetLanguage
      );
    }

    if (!workerState.isReady) {
      throw new WorkerError(
        `Worker for ${targetLanguage} is not ready`,
        targetLanguage
      );
    }

    // Check if already cancelled
    if (options?.signal?.aborted) {
      throw new TranslationCancelledError(targetLanguage);
    }

    // Check queue bounds
    const currentQueueLength = this.getQueueLength(targetLanguage);
    if (currentQueueLength >= this.maxQueueSize) {
      throw new QueueFullError(targetLanguage, currentQueueLength);
    }

    yield* this.enqueueStreamTask(workerState, text, options?.signal);
  }

  /**
   * Translates text to all supported target languages in parallel.
   * Returns results for all languages, with individual failures not blocking others.
   */
  async translateAll(
    text: string
  ): Promise<Map<TargetLanguage, TranslationResult | Error>> {
    const results = new Map<TargetLanguage, TranslationResult | Error>();

    const promises = TARGET_LANGUAGES.map(async (language) => {
      try {
        const result = await this.translate(text, language);
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
  getSupportedLanguages(): readonly TargetLanguage[] {
    return TARGET_LANGUAGES;
  }

  /**
   * Gets the current queue length for a specific language.
   * Useful for monitoring backpressure.
   */
  getQueueLength(targetLanguage: TargetLanguage): number {
    const workerState = this.workers.get(targetLanguage);
    if (!workerState) {
      return 0;
    }
    // Include current task in the count if present
    return workerState.queue.length + (workerState.currentTask ? 1 : 0);
  }

  protected getWorkerPath(): string {
    // In ES modules, we need to resolve the path relative to this file
    const thisFile = fileURLToPath(import.meta.url);
    const thisDir = dirname(thisFile);

    // The worker file is in the same directory
    // Use .js extension as TypeScript compiles to JS
    return join(thisDir, "translation.worker.js");
  }

  private async initializeWorker(
    language: TargetLanguage,
    workerPath: string
  ): Promise<void> {
    const initData: WorkerInitData = this.cacheDir
      ? { cacheDir: this.cacheDir, targetLanguage: language }
      : { targetLanguage: language };

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
    worker.on("message", (response: WorkerResponse) => {
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

      // Temporarily use currentTask for initialization
      (workerState as { currentTask: PendingTask | null }).currentTask = {
        id,
        type: "translate", // Use translate type for init
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
        onPartial: undefined,
        signal: undefined,
        timeoutId: null,
      };

      const message: WorkerMessage = {
        type: "initialize",
        id,
      };

      workerState.worker.postMessage(message);
    });
  }

  private enqueueTranslateTask(
    workerState: WorkerState,
    text: string,
    signal: AbortSignal | undefined
  ): Promise<TranslationResult> {
    return new Promise((resolve, reject) => {
      const id = this.generateTaskId();

      const task: TranslateTask = {
        id,
        type: "translate",
        text,
        signal,
        resolve,
        reject,
      };

      // Set up abort handler if signal provided
      if (signal) {
        const abortHandler = () => {
          // Remove from queue if still pending
          const queueIndex = workerState.queue.findIndex((t) => t.id === id);
          if (queueIndex !== -1) {
            workerState.queue.splice(queueIndex, 1);
            reject(new TranslationCancelledError(workerState.language));
          }
          // If currently processing, it will be handled by processNextTask
        };

        signal.addEventListener("abort", abortHandler, { once: true });
      }

      // Add to queue
      workerState.queue.push(task);

      // Try to process next task
      this.processNextTask(workerState);
    });
  }

  private async *enqueueStreamTask(
    workerState: WorkerState,
    text: string,
    signal: AbortSignal | undefined
  ): AsyncIterableIterator<TranslationResult> {
    const id = this.generateTaskId();

    // Create a channel for streaming results
    const partialResults: TranslationResult[] = [];
    let finalResult: TranslationResult | null = null;
    let error: Error | null = null;
    let resolveWait: (() => void) | null = null;
    let isDone = false;

    const task: TranslateStreamTask = {
      id,
      type: "translate-stream",
      text,
      signal,
      onPartial: (result) => {
        partialResults.push(result);
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      },
      resolve: (result) => {
        finalResult = result;
        isDone = true;
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      },
      reject: (err) => {
        error = err;
        isDone = true;
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      },
    };

    // Set up abort handler if signal provided
    if (signal) {
      const abortHandler = () => {
        // Remove from queue if still pending
        const queueIndex = workerState.queue.findIndex((t) => t.id === id);
        if (queueIndex !== -1) {
          workerState.queue.splice(queueIndex, 1);
          error = new TranslationCancelledError(workerState.language);
          isDone = true;
          if (resolveWait) {
            resolveWait();
            resolveWait = null;
          }
        }
      };

      signal.addEventListener("abort", abortHandler, { once: true });
    }

    // Add to queue
    workerState.queue.push(task);

    // Try to process next task
    this.processNextTask(workerState);

    // Yield results as they come in
    while (!isDone || partialResults.length > 0) {
      // Yield any pending partial results
      while (partialResults.length > 0) {
        yield partialResults.shift()!;
      }

      // If done and no more partials, break
      if (isDone) {
        break;
      }

      // Wait for more results
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
      });
    }

    // Check for error
    if (error) {
      throw error;
    }

    // Yield final result
    if (finalResult) {
      yield finalResult;
    }
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
      task.reject(new TranslationCancelledError(workerState.language));
      // Process next task
      this.processNextTask(workerState);
      return;
    }

    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (workerState.currentTask?.id === task.id) {
        // Clear the current task
        (workerState as { currentTask: PendingTask | null }).currentTask = null;
        task.reject(
          new TranslationTimeoutError(workerState.language, this.taskTimeoutMs)
        );
        // Process next task
        this.processNextTask(workerState);
      }
    }, this.taskTimeoutMs);

    // Set as current task
    (workerState as { currentTask: PendingTask | null }).currentTask = {
      id: task.id,
      type: task.type,
      resolve: task.resolve,
      reject: task.reject,
      onPartial: task.type === "translate-stream" ? task.onPartial : undefined,
      signal: task.signal,
      timeoutId,
    };

    // Send message to worker
    const message: WorkerMessage =
      task.type === "translate"
        ? { type: "translate", id: task.id, text: task.text }
        : { type: "translate-stream", id: task.id, text: task.text };

    workerState.worker.postMessage(message);
  }

  private async shutdownWorker(workerState: WorkerState): Promise<void> {
    // Reject all pending queue tasks
    for (const task of workerState.queue) {
      task.reject(
        new WorkerError("Worker shutting down", workerState.language)
      );
    }
    workerState.queue.length = 0;

    return new Promise((resolve) => {
      const id = this.generateTaskId();

      // Set a timeout for shutdown
      const timeoutId = setTimeout(() => {
        if (workerState.currentTask) {
          workerState.currentTask.reject(
            new WorkerError("Shutdown timeout", workerState.language)
          );
        }
        (workerState as { currentTask: PendingTask | null }).currentTask = null;
        void workerState.worker.terminate();
        resolve();
      }, 5000);

      // Set current task for shutdown response
      (workerState as { currentTask: PendingTask | null }).currentTask = {
        id,
        type: "translate",
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
        onPartial: undefined,
        signal: undefined,
        timeoutId: null,
      };

      const message: WorkerMessage = {
        type: "shutdown",
        id,
      };

      workerState.worker.postMessage(message);
    });
  }

  /**
   * Clear the timeout for a task if one is set.
   */
  private clearTaskTimeout(task: PendingTask): void {
    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
    }
  }

  private handleWorkerResponse(
    workerState: WorkerState,
    response: WorkerResponse
  ): void {
    const currentTask = workerState.currentTask;

    // Verify response matches current task
    if (!currentTask || currentTask.id !== response.id) {
      return;
    }

    switch (response.type) {
      case "initialized": {
        // Clear timeout and resolve initialization
        this.clearTaskTimeout(currentTask);
        currentTask.resolve({
          text: "",
          sourceLanguage: "en",
          targetLanguage: workerState.language,
          isPartial: false,
        });
        break;
      }
      case "translated": {
        // Clear timeout and complete the task
        this.clearTaskTimeout(currentTask);
        (workerState as { currentTask: PendingTask | null }).currentTask = null;
        currentTask.resolve(response.result);
        // Process next task
        this.processNextTask(workerState);
        break;
      }
      case "translate-stream-partial": {
        // Emit partial result but don't complete the task (keep timeout running)
        if (currentTask.onPartial) {
          currentTask.onPartial(response.result);
        }
        break;
      }
      case "translate-stream-complete": {
        // Clear timeout and complete the streaming task
        this.clearTaskTimeout(currentTask);
        (workerState as { currentTask: PendingTask | null }).currentTask = null;
        currentTask.resolve(response.result);
        // Process next task
        this.processNextTask(workerState);
        break;
      }
      case "error": {
        // Clear timeout and complete with error
        this.clearTaskTimeout(currentTask);
        (workerState as { currentTask: PendingTask | null }).currentTask = null;
        currentTask.reject(
          new WorkerError(response.error, workerState.language)
        );
        // Process next task
        this.processNextTask(workerState);
        break;
      }
      case "shutdown": {
        // Clear timeout and resolve shutdown
        this.clearTaskTimeout(currentTask);
        currentTask.resolve({
          text: "",
          sourceLanguage: "en",
          targetLanguage: workerState.language,
          isPartial: false,
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
        new WorkerError(error.message, workerState.language)
      );
      (workerState as { currentTask: PendingTask | null }).currentTask = null;
    }

    // Reject all queued tasks
    for (const task of workerState.queue) {
      task.reject(new WorkerError(error.message, workerState.language));
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
        new WorkerError(errorMessage, workerState.language)
      );
      (workerState as { currentTask: PendingTask | null }).currentTask = null;
    }

    (workerState as { isReady: boolean }).isReady = false;

    // Attempt restart if within limits and pool is still initialized
    if (
      this.isInitialized &&
      workerState.restartCount < this.maxRestartAttempts
    ) {
      // Schedule restart
      setTimeout(() => {
        void this.restartWorker(workerState);
      }, this.restartDelayMs);
    } else {
      // No more restarts - reject all queued tasks
      for (const task of workerState.queue) {
        task.reject(new WorkerError(errorMessage, workerState.language));
      }
      workerState.queue.length = 0;
    }
  }

  /**
   * Restart a failed worker.
   */
  private async restartWorker(workerState: WorkerState): Promise<void> {
    if (!this.isInitialized) {
      // Pool was shut down, don't restart
      return;
    }

    workerState.restartCount++;

    try {
      const workerPath = this.getWorkerPath();
      const initData: WorkerInitData = this.cacheDir
        ? { cacheDir: this.cacheDir, targetLanguage: workerState.language }
        : { targetLanguage: workerState.language };

      const newWorker = new Worker(workerPath, {
        workerData: initData,
      });

      // Replace the worker
      workerState.worker = newWorker;

      // Set up handlers for new worker
      newWorker.on("message", (response: WorkerResponse) => {
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

      // Send initialization and wait
      await this.sendInitializeMessage(workerState);

      // Worker is back up - process any queued tasks
      this.processNextTask(workerState);
    } catch (error) {
      // Restart failed - reject all queued tasks
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      for (const task of workerState.queue) {
        task.reject(new WorkerError(errorMessage, workerState.language));
      }
      workerState.queue.length = 0;
    }
  }

  private generateTaskId(): string {
    return `task-${++this.taskIdCounter}`;
  }
}

export function createTranslationWorkerPool(
  options?: Readonly<TranslationWorkerPoolOptions>
): TranslationWorkerPool {
  return new TranslationWorkerPool(options);
}
