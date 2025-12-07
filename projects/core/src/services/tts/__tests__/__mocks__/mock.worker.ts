/**
 * Mock TTS worker for unit testing.
 *
 * Simulates the XTTS server responses without requiring the actual server.
 */
import { parentPort, workerData } from "node:worker_threads";

import type {
  TTSWorkerInitData,
  TTSWorkerMessage,
  TTSInitializedResponse,
  TTSSynthesizedResponse,
  TTSErrorResponse,
  TTSShutdownResponse,
} from "../../tts.worker.js";

/**
 * Mock audio sample rate.
 */
const MOCK_SAMPLE_RATE = 22050;

/**
 * Mock audio duration per word (approximate).
 */
const MOCK_DURATION_PER_WORD_SECONDS = 0.3;

/**
 * Worker state.
 */
let isInitialized = false;
let targetLanguage: string | null = null;

/**
 * Generate mock audio data for a given text.
 */
function generateMockAudio(text: string): {
  audio: ArrayBuffer;
  sampleRate: number;
  duration: number;
} {
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length || 1;
  const duration = wordCount * MOCK_DURATION_PER_WORD_SECONDS;
  const sampleCount = Math.floor(duration * MOCK_SAMPLE_RATE);

  // Generate simple sine wave audio
  const audio = new Float32Array(sampleCount);
  const frequency = 440; // A4 note

  for (let i = 0; i < sampleCount; i++) {
    const t = i / MOCK_SAMPLE_RATE;
    audio[i] = Math.sin(2 * Math.PI * frequency * t) * 0.5;
  }

  return {
    audio: audio.buffer,
    sampleRate: MOCK_SAMPLE_RATE,
    duration,
  };
}

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
      await handleSynthesize(port, message.id, message.text);
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
  // Simulate small delay for initialization
  await new Promise((resolve) => setTimeout(resolve, 10));

  const initData = workerData as TTSWorkerInitData;
  targetLanguage = initData.targetLanguage;
  isInitialized = true;

  const response: TTSInitializedResponse = {
    type: "initialized",
    id,
    success: true,
  };
  port.postMessage(response);
}

async function handleSynthesize(
  port: NonNullable<typeof parentPort>,
  id: string,
  text: string
): Promise<void> {
  if (!isInitialized || !targetLanguage) {
    const response: TTSErrorResponse = {
      type: "error",
      id,
      error: "Worker not initialized",
      code: "NOT_INITIALIZED",
    };
    port.postMessage(response);
    return;
  }

  // Simulate synthesis delay
  await new Promise((resolve) => setTimeout(resolve, 50));

  const mockAudio = generateMockAudio(text);

  const response: TTSSynthesizedResponse = {
    type: "synthesized",
    id,
    result: mockAudio,
  };

  // Transfer the audio buffer
  port.postMessage(response, [mockAudio.audio]);
}

async function handleShutdown(
  port: NonNullable<typeof parentPort>,
  id: string
): Promise<void> {
  isInitialized = false;
  targetLanguage = null;

  const response: TTSShutdownResponse = {
    type: "shutdown",
    id,
    success: true,
  };
  port.postMessage(response);
}

// Set up message handler
if (parentPort) {
  parentPort.on("message", (message: TTSWorkerMessage) => {
    void handleMessage(message);
  });
}
