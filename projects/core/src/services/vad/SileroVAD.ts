import * as ort from "onnxruntime-node";
import { join } from "node:path";

import type {
  IVAD,
  VADOptions,
  VADSegment,
  VADEvent,
  VADAudioMetadata,
} from "../../interfaces/IVAD.js";
import type { IModelManager } from "../../interfaces/IModelManager.js";
import { resampleLinear } from "../../audio/AudioResampler.js";
import { stereoToMono } from "../../audio/AudioConverter.js";
import {
  NotInitializedError,
  InvalidSampleRateError,
  InvalidChannelCountError,
} from "../../errors/AudioProcessingError.js";

/**
 * Silero VAD model constants.
 * The model expects 512 samples at 16kHz (32ms chunks).
 */
const SILERO_SAMPLE_RATE = 16000;
const SILERO_CHUNK_SIZE = 512; // 32ms at 16kHz
const DEFAULT_THRESHOLD = 0.5;
const DEFAULT_MIN_SILENCE_DURATION_MS = 100;
const DEFAULT_MIN_SPEECH_DURATION_MS = 250;
const DEFAULT_SPEECH_PAD_MS = 30;

// Silero VAD state dimensions: [2, 1, 128] for LSTM layers
const STATE_DIM_0 = 2;
const STATE_DIM_1 = 1;
const STATE_DIM_2 = 128;

export interface SileroVADOptions {
  readonly modelManager: IModelManager;
  readonly vadOptions?: Readonly<VADOptions>;
}

/**
 * Internal state for tracking speech segments during streaming.
 */
interface SpeechState {
  isSpeaking: boolean;
  speechStartTime: number;
  silenceStartTime: number;
  currentTime: number;
  lastProbability: number;
  /** Buffer for samples that don't fill a complete chunk */
  pendingSamples: Float32Array;
  pendingSamplesCount: number;
}

/**
 * Voice Activity Detection using Silero VAD ONNX model.
 *
 * The Silero VAD model expects audio in 512-sample chunks at 16kHz.
 * It maintains internal LSTM state across chunks for temporal context.
 *
 * Supports both batch processing (process()) and streaming (push()/flush()).
 */
export class SileroVAD implements IVAD {
  private readonly modelManager: IModelManager;
  private readonly threshold: number;
  private readonly minSilenceDurationMs: number;
  private readonly minSpeechDurationMs: number;
  private readonly speechPadMs: number;

  private session: ort.InferenceSession | null = null;
  private stateTensor: ort.Tensor | null = null;
  private srTensor: ort.Tensor | null = null;

  // Speech detection state
  private state: SpeechState = this.createInitialState();

  constructor(options: Readonly<SileroVADOptions>) {
    this.modelManager = options.modelManager;

    const vadOptions = options.vadOptions ?? {};
    this.threshold = vadOptions.threshold ?? DEFAULT_THRESHOLD;
    this.minSilenceDurationMs =
      vadOptions.minSilenceDurationMs ?? DEFAULT_MIN_SILENCE_DURATION_MS;
    this.minSpeechDurationMs =
      vadOptions.minSpeechDurationMs ?? DEFAULT_MIN_SPEECH_DURATION_MS;
    this.speechPadMs = vadOptions.speechPadMs ?? DEFAULT_SPEECH_PAD_MS;
  }

  private createInitialState(): SpeechState {
    return {
      isSpeaking: false,
      speechStartTime: 0,
      silenceStartTime: 0,
      currentTime: 0,
      lastProbability: 0,
      pendingSamples: new Float32Array(SILERO_CHUNK_SIZE),
      pendingSamplesCount: 0,
    };
  }

  get isReady(): boolean {
    return this.session !== null;
  }

  async initialize(): Promise<void> {
    if (this.session) {
      return;
    }

    const modelDir = await this.modelManager.ensureModel("silero-vad");
    const modelPath = join(modelDir, "onnx", "model.onnx");

    this.session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ["cpu"],
    });

    this.initializeModelState();
  }

  private initializeModelState(): void {
    // Initialize combined state tensor to zeros
    // Shape: [2, 1, 128] for 2-layer LSTM with batch size 1 and hidden size 128
    const stateShape = [STATE_DIM_0, STATE_DIM_1, STATE_DIM_2];
    const stateData = new Float32Array(
      STATE_DIM_0 * STATE_DIM_1 * STATE_DIM_2
    ).fill(0);

    this.stateTensor = new ort.Tensor("float32", stateData, stateShape);

    // Sample rate tensor (scalar)
    this.srTensor = new ort.Tensor(
      "int64",
      BigInt64Array.from([BigInt(SILERO_SAMPLE_RATE)]),
      []
    );
  }

  /**
   * Processes a complete audio buffer and returns all detected segments.
   * This is a convenience method that uses push() + flush() internally.
   */
  async process(
    audioData: Float32Array,
    metadata?: Readonly<VADAudioMetadata>
  ): Promise<readonly VADSegment[]> {
    if (!this.session || !this.stateTensor || !this.srTensor) {
      throw new NotInitializedError("SileroVAD");
    }

    // Reset state for fresh processing
    this.reset();

    const segments: VADSegment[] = [];

    // Process all audio through push()
    for await (const event of this.push(audioData, metadata)) {
      if (!event.isPartial) {
        segments.push(event.segment);
      }
    }

    // Flush any remaining speech
    const finalEvent = await this.flush();
    if (finalEvent && !finalEvent.isPartial) {
      segments.push(finalEvent.segment);
    }

    return segments;
  }

  /**
   * Pushes audio chunk for streaming VAD processing.
   * Yields finalized segments when silence is detected, and partial updates.
   * @yields {VADEvent} Finalized segments (isPartial=false) and partial updates (isPartial=true)
   */
  async *push(
    audioData: Float32Array,
    metadata?: Readonly<VADAudioMetadata>
  ): AsyncIterableIterator<VADEvent> {
    if (!this.session || !this.stateTensor || !this.srTensor) {
      throw new NotInitializedError("SileroVAD");
    }

    // Validate and preprocess audio
    const samples = this.preprocessAudio(audioData, metadata);

    if (samples.length === 0) {
      return;
    }

    // Combine with any pending samples from previous push
    const totalSamples = this.state.pendingSamplesCount + samples.length;
    const combined = new Float32Array(totalSamples);

    if (this.state.pendingSamplesCount > 0) {
      combined.set(
        this.state.pendingSamples.subarray(0, this.state.pendingSamplesCount)
      );
    }
    combined.set(samples, this.state.pendingSamplesCount);

    let offset = 0;

    // Process complete chunks
    while (offset + SILERO_CHUNK_SIZE <= combined.length) {
      const chunk = combined.slice(offset, offset + SILERO_CHUNK_SIZE);
      const event = await this.processChunkWithEvent(chunk);

      if (event) {
        yield event;
      }

      offset += SILERO_CHUNK_SIZE;
    }

    // Store remaining samples for next push
    const remaining = combined.length - offset;
    if (remaining > 0) {
      this.state.pendingSamples.set(combined.slice(offset));
      this.state.pendingSamplesCount = remaining;
    } else {
      this.state.pendingSamplesCount = 0;
    }

    // Yield partial update if speech is in progress
    if (this.state.isSpeaking) {
      const partialSegment = this.getCurrentSegment();
      if (partialSegment) {
        yield { segment: partialSegment, isPartial: true };
      }
    }
  }

  /**
   * Signals end of audio stream. Finalizes any in-progress speech segment.
   */
  async flush(): Promise<VADEvent | null> {
    if (!this.session || !this.stateTensor || !this.srTensor) {
      throw new NotInitializedError("SileroVAD");
    }

    // Process any remaining pending samples with zero-padding
    if (this.state.pendingSamplesCount > 0) {
      const paddedChunk = new Float32Array(SILERO_CHUNK_SIZE);
      paddedChunk.set(
        this.state.pendingSamples.subarray(0, this.state.pendingSamplesCount)
      );
      await this.processChunkInternal(paddedChunk);
      this.state.pendingSamplesCount = 0;
    }

    // If speech is still in progress, finalize it
    if (this.state.isSpeaking) {
      const speechDuration =
        this.state.currentTime - this.state.speechStartTime;

      // Only emit if speech meets minimum duration
      if (speechDuration >= this.minSpeechDurationMs) {
        const segment: VADSegment = {
          start: this.state.speechStartTime / 1000,
          end: (this.state.currentTime + this.speechPadMs) / 1000,
          confidence: this.state.lastProbability,
        };

        // Reset speaking state
        this.state.isSpeaking = false;
        this.state.speechStartTime = 0;
        this.state.silenceStartTime = 0;

        return { segment, isPartial: false };
      }

      // Speech too short, discard it
      this.state.isSpeaking = false;
      this.state.speechStartTime = 0;
      this.state.silenceStartTime = 0;
    }

    return null;
  }

  /**
   * Returns the current in-progress speech segment, if any.
   */
  getCurrentSegment(): VADSegment | null {
    if (!this.state.isSpeaking) {
      return null;
    }

    return {
      start: this.state.speechStartTime / 1000,
      end: this.state.currentTime / 1000,
      confidence: this.state.lastProbability,
    };
  }

  /**
   * Preprocesses audio to 16kHz mono format required by Silero VAD.
   *
   * @throws {InvalidSampleRateError} If sample rate is not positive
   * @throws {InvalidChannelCountError} If channel count is less than 1
   */
  private preprocessAudio(
    audioData: Float32Array,
    metadata?: VADAudioMetadata
  ): Float32Array {
    if (audioData.length === 0) {
      return audioData;
    }

    // Use provided metadata or assume 16kHz mono (Silero's expected format)
    const effectiveMetadata = metadata ?? {
      sampleRate: SILERO_SAMPLE_RATE,
      channels: 1,
    };

    // Validate metadata
    if (effectiveMetadata.sampleRate <= 0) {
      throw new InvalidSampleRateError(effectiveMetadata.sampleRate);
    }
    if (effectiveMetadata.channels < 1) {
      throw new InvalidChannelCountError(effectiveMetadata.channels);
    }

    let samples = audioData;

    // Convert to mono if stereo
    if (effectiveMetadata.channels > 1) {
      samples = stereoToMono(samples, effectiveMetadata.channels);
    }

    // Resample to 16kHz if needed
    if (effectiveMetadata.sampleRate !== SILERO_SAMPLE_RATE) {
      samples = resampleLinear(samples, {
        inputSampleRate: effectiveMetadata.sampleRate,
        outputSampleRate: SILERO_SAMPLE_RATE,
      });
    }

    return samples;
  }

  /**
   * Processes a single chunk and returns a VADEvent if a segment was finalized.
   */
  private async processChunkWithEvent(
    chunk: Float32Array
  ): Promise<VADEvent | null> {
    const probability = await this.runInference(chunk);
    if (probability === null) {
      return null;
    }

    const chunkDurationMs = (SILERO_CHUNK_SIZE / SILERO_SAMPLE_RATE) * 1000;
    const event = this.updateSpeechState(probability, chunkDurationMs);

    this.state.currentTime += chunkDurationMs;
    this.state.lastProbability = probability;

    return event;
  }

  /**
   * Processes a chunk without returning an event (for internal use).
   */
  private async processChunkInternal(chunk: Float32Array): Promise<void> {
    const probability = await this.runInference(chunk);
    if (probability === null) {
      return;
    }

    const chunkDurationMs = (SILERO_CHUNK_SIZE / SILERO_SAMPLE_RATE) * 1000;
    this.updateSpeechState(probability, chunkDurationMs);

    this.state.currentTime += chunkDurationMs;
    this.state.lastProbability = probability;
  }

  /**
   * Runs the ONNX inference for a single chunk.
   */
  private async runInference(chunk: Float32Array): Promise<number | null> {
    if (!this.session || !this.stateTensor || !this.srTensor) {
      return null;
    }

    // Create input tensor [1, chunk_size]
    const inputTensor = new ort.Tensor("float32", chunk, [1, chunk.length]);

    const feeds = {
      input: inputTensor,
      state: this.stateTensor,
      sr: this.srTensor,
    };

    const results = await this.session.run(feeds);

    // Update state with the new state tensor
    const newState = results["stateN"];
    if (newState) {
      this.stateTensor = newState as ort.Tensor;
    }

    // Get probability output
    const outputTensor = results["output"];
    if (!outputTensor) {
      return null;
    }

    return (outputTensor.data as Float32Array)[0] ?? 0;
  }

  /**
   * Updates speech detection state based on probability.
   * Returns a VADEvent if a segment was finalized by silence.
   */
  private updateSpeechState(
    probability: number,
    chunkDurationMs: number
  ): VADEvent | null {
    const isSpeechChunk = probability >= this.threshold;

    if (isSpeechChunk) {
      if (!this.state.isSpeaking) {
        // Speech started
        this.state.isSpeaking = true;
        this.state.speechStartTime = Math.max(
          0,
          this.state.currentTime - this.speechPadMs
        );
      }
      // Reset silence counter when speech is detected
      this.state.silenceStartTime = 0;
      return null;
    }

    // Silence detected
    if (this.state.isSpeaking) {
      if (this.state.silenceStartTime === 0) {
        // Silence just started
        this.state.silenceStartTime = this.state.currentTime;
      }

      const silenceDuration =
        this.state.currentTime + chunkDurationMs - this.state.silenceStartTime;

      if (silenceDuration >= this.minSilenceDurationMs) {
        // Speech ended - emit segment if it meets minimum duration
        const speechDuration =
          this.state.silenceStartTime - this.state.speechStartTime;

        if (speechDuration >= this.minSpeechDurationMs) {
          const segment: VADSegment = {
            start: this.state.speechStartTime / 1000,
            end: (this.state.silenceStartTime + this.speechPadMs) / 1000,
            confidence: probability,
          };

          this.state.isSpeaking = false;
          this.state.silenceStartTime = 0;

          return { segment, isPartial: false };
        }

        // Speech too short, discard it
        this.state.isSpeaking = false;
        this.state.silenceStartTime = 0;
      }
    }

    return null;
  }

  reset(): void {
    this.initializeModelState();
    this.state = this.createInitialState();
  }

  async dispose(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
    this.stateTensor = null;
    this.srTensor = null;
  }
}

export function createSileroVAD(
  options: Readonly<SileroVADOptions>
): SileroVAD {
  return new SileroVAD(options);
}
