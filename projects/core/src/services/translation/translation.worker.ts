/**
 * Translation worker thread entry point.
 *
 * Hosts a single NLLB translator instance for a specific target language.
 * Uses Node.js worker_threads for inter-thread communication.
 */
import { parentPort, workerData } from "node:worker_threads";

import { createNLLBTranslator, type NLLBTranslator } from "./NLLBTranslator.js";
import type { TranslationResult } from "../../interfaces/ITranslator.js";

/**
 * Worker initialization data passed via workerData.
 */
export interface WorkerInitData {
  readonly cacheDir?: string;
  readonly targetLanguage: string;
}

/**
 * Message types for worker communication.
 * Uses discriminated union for type-safe message handling.
 */
export type WorkerMessage =
  | InitializeMessage
  | TranslateMessage
  | TranslateStreamMessage
  | ShutdownMessage;

export interface InitializeMessage {
  readonly type: "initialize";
  readonly id: string;
}

export interface TranslateMessage {
  readonly type: "translate";
  readonly id: string;
  readonly text: string;
}

export interface TranslateStreamMessage {
  readonly type: "translate-stream";
  readonly id: string;
  readonly text: string;
}

export interface ShutdownMessage {
  readonly type: "shutdown";
  readonly id: string;
}

/**
 * Response types from worker.
 */
export type WorkerResponse =
  | InitializedResponse
  | TranslatedResponse
  | TranslateStreamPartialResponse
  | TranslateStreamCompleteResponse
  | ErrorResponse
  | ShutdownResponse;

export interface InitializedResponse {
  readonly type: "initialized";
  readonly id: string;
  readonly success: true;
}

export interface TranslatedResponse {
  readonly type: "translated";
  readonly id: string;
  readonly result: TranslationResult;
}

export interface TranslateStreamPartialResponse {
  readonly type: "translate-stream-partial";
  readonly id: string;
  readonly result: TranslationResult;
}

export interface TranslateStreamCompleteResponse {
  readonly type: "translate-stream-complete";
  readonly id: string;
  readonly result: TranslationResult;
}

export interface ErrorResponse {
  readonly type: "error";
  readonly id: string;
  readonly error: string;
  readonly code?: string;
}

export interface ShutdownResponse {
  readonly type: "shutdown";
  readonly id: string;
  readonly success: true;
}

/**
 * Worker state.
 */
let translator: NLLBTranslator | null = null;
let targetLanguage: string | null = null;

/**
 * Handles incoming messages from the main thread.
 */
async function handleMessage(message: WorkerMessage): Promise<void> {
  const port = parentPort;
  if (!port) {
    return;
  }

  switch (message.type) {
    case "initialize": {
      await handleInitialize(port, message.id);
      break;
    }
    case "translate": {
      await handleTranslate(port, message.id, message.text);
      break;
    }
    case "translate-stream": {
      await handleTranslateStream(port, message.id, message.text);
      break;
    }
    case "shutdown": {
      await handleShutdown(port, message.id);
      break;
    }
  }
}

async function handleInitialize(
  port: NonNullable<typeof parentPort>,
  id: string
): Promise<void> {
  try {
    const initData = workerData as WorkerInitData;
    targetLanguage = initData.targetLanguage;

    const translatorOptions = initData.cacheDir
      ? { cacheDir: initData.cacheDir, quantized: true }
      : { quantized: true };
    translator = createNLLBTranslator(translatorOptions);

    await translator.initialize();

    const response: InitializedResponse = {
      type: "initialized",
      id,
      success: true,
    };
    port.postMessage(response);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const response: ErrorResponse = {
      type: "error",
      id,
      error: `Initialization failed: ${errorMessage}`,
    };
    port.postMessage(response);
  }
}

async function handleTranslate(
  port: NonNullable<typeof parentPort>,
  id: string,
  text: string
): Promise<void> {
  try {
    if (!translator || !targetLanguage) {
      const response: ErrorResponse = {
        type: "error",
        id,
        error: "Worker not initialized",
        code: "NOT_INITIALIZED",
      };
      port.postMessage(response);
      return;
    }

    const result = await translator.translate(text, {
      sourceLanguage: "en",
      targetLanguage,
    });

    const response: TranslatedResponse = {
      type: "translated",
      id,
      result,
    };
    port.postMessage(response);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const errorCode =
      error instanceof Error && "code" in error
        ? String((error as { code: unknown }).code)
        : null;

    const response: ErrorResponse = errorCode
      ? { type: "error", id, error: errorMessage, code: errorCode }
      : { type: "error", id, error: errorMessage };
    port.postMessage(response);
  }
}

async function handleTranslateStream(
  port: NonNullable<typeof parentPort>,
  id: string,
  text: string
): Promise<void> {
  try {
    if (!translator || !targetLanguage) {
      const response: ErrorResponse = {
        type: "error",
        id,
        error: "Worker not initialized",
        code: "NOT_INITIALIZED",
      };
      port.postMessage(response);
      return;
    }

    // Use the streaming translation API
    for await (const result of translator.translateStream(text, {
      sourceLanguage: "en",
      targetLanguage,
    })) {
      if (result.isPartial) {
        const response: TranslateStreamPartialResponse = {
          type: "translate-stream-partial",
          id,
          result,
        };
        port.postMessage(response);
      } else {
        const response: TranslateStreamCompleteResponse = {
          type: "translate-stream-complete",
          id,
          result,
        };
        port.postMessage(response);
      }
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const errorCode =
      error instanceof Error && "code" in error
        ? String((error as { code: unknown }).code)
        : null;

    const response: ErrorResponse = errorCode
      ? { type: "error", id, error: errorMessage, code: errorCode }
      : { type: "error", id, error: errorMessage };
    port.postMessage(response);
  }
}

async function handleShutdown(
  port: NonNullable<typeof parentPort>,
  id: string
): Promise<void> {
  try {
    if (translator) {
      await translator.dispose();
      translator = null;
    }
    targetLanguage = null;

    const response: ShutdownResponse = {
      type: "shutdown",
      id,
      success: true,
    };
    port.postMessage(response);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const response: ErrorResponse = {
      type: "error",
      id,
      error: `Shutdown failed: ${errorMessage}`,
    };
    port.postMessage(response);
  }
}

// Set up message handler
if (parentPort) {
  parentPort.on("message", (message: WorkerMessage) => {
    void handleMessage(message);
  });
}
