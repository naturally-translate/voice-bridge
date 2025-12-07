/**
 * TTS worker thread entry point.
 *
 * Hosts a single XTTS client instance for a specific target language.
 * Uses Node.js worker_threads for inter-thread communication.
 */
import { parentPort, workerData } from "node:worker_threads";

import { createXTTSClient, type XTTSClient } from "./XTTSClient.js";

/**
 * Worker initialization data passed via workerData.
 */
export interface TTSWorkerInitData {
  readonly serverUrl?: string;
  readonly targetLanguage: string;
  readonly timeoutMs?: number;
}

/**
 * Speaker embedding passed to worker for synthesis.
 */
export interface SerializedEmbedding {
  readonly data: ArrayBuffer;
  readonly shape: readonly number[];
}

/**
 * Message types for worker communication.
 * Uses discriminated union for type-safe message handling.
 */
export type TTSWorkerMessage =
  | TTSInitializeMessage
  | TTSSynthesizeMessage
  | TTSShutdownMessage;

export interface TTSInitializeMessage {
  readonly type: "initialize";
  readonly id: string;
}

export interface TTSSynthesizeMessage {
  readonly type: "synthesize";
  readonly id: string;
  readonly text: string;
  readonly embedding?: SerializedEmbedding | undefined;
  readonly speed?: number | undefined;
  readonly fallbackToNeutral?: boolean | undefined;
}

export interface TTSShutdownMessage {
  readonly type: "shutdown";
  readonly id: string;
}

/**
 * Response types from worker.
 */
export type TTSWorkerResponse =
  | TTSInitializedResponse
  | TTSSynthesizedResponse
  | TTSErrorResponse
  | TTSShutdownResponse;

export interface TTSInitializedResponse {
  readonly type: "initialized";
  readonly id: string;
  readonly success: true;
}

export interface TTSSynthesizedResponse {
  readonly type: "synthesized";
  readonly id: string;
  readonly result: {
    readonly audio: ArrayBuffer;
    readonly sampleRate: number;
    readonly duration: number;
  };
}

export interface TTSErrorResponse {
  readonly type: "error";
  readonly id: string;
  readonly error: string;
  readonly code?: string;
}

export interface TTSShutdownResponse {
  readonly type: "shutdown";
  readonly id: string;
  readonly success: true;
}

/**
 * Worker state.
 */
let client: XTTSClient | null = null;
let targetLanguage: string | null = null;

/**
 * Handles incoming messages from the main thread.
 */
async function handleMessage(message: TTSWorkerMessage): Promise<void> {
  const port = parentPort;
  if (!port) {
    return;
  }

  switch (message.type) {
    case "initialize": {
      await handleInitialize(port, message.id);
      break;
    }
    case "synthesize": {
      await handleSynthesize(port, message.id, message);
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
    const initData = workerData as TTSWorkerInitData;
    targetLanguage = initData.targetLanguage;

    // Build options object conditionally based on defined values
    client = createXTTSClient(
      initData.serverUrl !== undefined && initData.timeoutMs !== undefined
        ? { serverUrl: initData.serverUrl, timeoutMs: initData.timeoutMs }
        : initData.serverUrl !== undefined
          ? { serverUrl: initData.serverUrl }
          : initData.timeoutMs !== undefined
            ? { timeoutMs: initData.timeoutMs }
            : undefined
    );

    // Verify server is healthy
    await client.checkHealth();

    const response: TTSInitializedResponse = {
      type: "initialized",
      id,
      success: true,
    };
    port.postMessage(response);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const response: TTSErrorResponse = {
      type: "error",
      id,
      error: `Initialization failed: ${errorMessage}`,
    };
    port.postMessage(response);
  }
}

async function handleSynthesize(
  port: NonNullable<typeof parentPort>,
  id: string,
  message: TTSSynthesizeMessage
): Promise<void> {
  try {
    if (!client || !targetLanguage) {
      const response: TTSErrorResponse = {
        type: "error",
        id,
        error: "Worker not initialized",
        code: "NOT_INITIALIZED",
      };
      port.postMessage(response);
      return;
    }

    // Build synthesize options, conditionally including optional properties
    const baseOptions = {
      text: message.text,
      language: targetLanguage as "es" | "zh" | "ko",
    };

    // Deserialize embedding if provided
    const embedding = message.embedding
      ? {
          data: new Float32Array(message.embedding.data),
          shape: message.embedding.shape,
        }
      : undefined;

    // Build the final options based on what's defined
    const synthesizeOptions: Parameters<typeof client.synthesize>[0] = {
      ...baseOptions,
    };
    if (embedding !== undefined) {
      (synthesizeOptions as { embedding: typeof embedding }).embedding = embedding;
    }
    if (message.speed !== undefined) {
      (synthesizeOptions as { speed: number }).speed = message.speed;
    }
    if (message.fallbackToNeutral !== undefined) {
      (synthesizeOptions as { fallbackToNeutral: boolean }).fallbackToNeutral = message.fallbackToNeutral;
    }

    const result = await client.synthesize(synthesizeOptions);

    // Transfer audio buffer to avoid copying
    // Create a new ArrayBuffer copy to ensure it's transferable
    const sourceBuffer = result.audio.buffer;
    const audioBuffer = new ArrayBuffer(result.audio.byteLength);
    new Uint8Array(audioBuffer).set(
      new Uint8Array(sourceBuffer, result.audio.byteOffset, result.audio.byteLength)
    );

    const response: TTSSynthesizedResponse = {
      type: "synthesized",
      id,
      result: {
        audio: audioBuffer,
        sampleRate: result.sampleRate,
        duration: result.duration,
      },
    };

    // Transfer the audio buffer for efficiency
    port.postMessage(response, [audioBuffer]);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const errorCode =
      error instanceof Error && "code" in error
        ? String((error as { code: unknown }).code)
        : undefined;

    const response: TTSErrorResponse = errorCode
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
    // No cleanup needed for XTTSClient (stateless HTTP client)
    client = null;
    targetLanguage = null;

    const response: TTSShutdownResponse = {
      type: "shutdown",
      id,
      success: true,
    };
    port.postMessage(response);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const response: TTSErrorResponse = {
      type: "error",
      id,
      error: `Shutdown failed: ${errorMessage}`,
    };
    port.postMessage(response);
  }
}

// Set up message handler
if (parentPort) {
  parentPort.on("message", (message: TTSWorkerMessage) => {
    void handleMessage(message);
  });
}
