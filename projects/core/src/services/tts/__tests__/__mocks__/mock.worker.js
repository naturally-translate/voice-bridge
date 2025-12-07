/**
 * Mock TTS worker for unit testing.
 *
 * Simulates the XTTS server responses without requiring the actual server.
 */
import { parentPort, workerData } from "node:worker_threads";

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
let targetLanguage = null;

/**
 * Generate mock audio data for a given text.
 */
function generateMockAudio(text) {
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
async function handleMessage(message) {
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

async function handleInitialize(port, id) {
  // Simulate small delay for initialization
  await new Promise((resolve) => setTimeout(resolve, 10));

  targetLanguage = workerData.targetLanguage;
  isInitialized = true;

  const response = {
    type: "initialized",
    id,
    success: true,
  };
  port.postMessage(response);
}

async function handleSynthesize(port, id, text) {
  if (!isInitialized || !targetLanguage) {
    const response = {
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

  const response = {
    type: "synthesized",
    id,
    result: mockAudio,
  };

  // Transfer the audio buffer
  port.postMessage(response, [mockAudio.audio]);
}

async function handleShutdown(port, id) {
  isInitialized = false;
  targetLanguage = null;

  const response = {
    type: "shutdown",
    id,
    success: true,
  };
  port.postMessage(response);
}

// Set up message handler
if (parentPort) {
  parentPort.on("message", (message) => {
    void handleMessage(message);
  });
}
