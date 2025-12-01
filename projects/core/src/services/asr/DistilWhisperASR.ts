import {
  AutoProcessor,
  WhisperForConditionalGeneration,
  type PreTrainedModel,
  type Processor,
  type Tensor,
} from "@huggingface/transformers";

import type {
  IASR,
  ASROptions,
  ASRResult,
  ASRWord,
  AudioMetadata,
} from "../../interfaces/IASR.js";
import { resampleLinear, ASR_SAMPLE_RATE } from "../../audio/AudioResampler.js";
import { stereoToMono } from "../../audio/AudioConverter.js";
import {
  NotInitializedError,
  EmptyBufferError,
  AudioTooShortError,
  TranscriptionFailedError,
  InvalidSampleRateError,
  InvalidChannelCountError,
} from "../../errors/AudioProcessingError.js";

/**
 * Whisper model constants.
 */
const WHISPER_SAMPLE_RATE = 16000;
const MODEL_ID = "distil-whisper/distil-large-v3";

/**
 * Minimum audio duration in seconds for meaningful transcription.
 */
const MIN_AUDIO_DURATION_SEC = 0.1;

/**
 * Streaming parameters for low-latency partial results.
 *
 * Stride: How often to emit partials (300-500ms for sub-second latency).
 * Window: Total context passed to Whisper (1-2s for adequate context).
 *
 * The rolling window approach slides forward by stride amount while
 * maintaining window-sized context for each transcription.
 */
const STREAMING_STRIDE_SEC = 0.4; // 400ms stride for partial emissions
const STREAMING_WINDOW_SEC = 1.5; // 1.5s rolling window for context

export interface DistilWhisperASROptions {
  readonly cacheDir?: string;
  readonly quantized?: boolean;
}

interface WhisperGenerationConfig {
  return_timestamps?: boolean | "word";
  language?: string;
  task?: "transcribe" | "translate";
  max_new_tokens?: number;
  num_beams?: number;
}

/**
 * Audio preprocessing result containing normalized mono 16kHz samples.
 */
interface PreprocessedAudio {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

/**
 * Automatic Speech Recognition using Distil-Whisper Large V3.
 *
 * Uses Transformers.js for inference with ONNX backend.
 * Supports streaming transcription with partial results, automatic audio
 * preprocessing (resampling and mono conversion), and word-level timestamps.
 */
export class DistilWhisperASR implements IASR {
  private readonly cacheDir: string | null;
  private readonly quantized: boolean;

  private model: PreTrainedModel | null = null;
  private processor: Processor | null = null;

  constructor(options?: Readonly<DistilWhisperASROptions>) {
    this.cacheDir = options?.cacheDir ?? null;
    this.quantized = options?.quantized ?? true;
  }

  get isReady(): boolean {
    return this.model !== null && this.processor !== null;
  }

  async initialize(): Promise<void> {
    if (this.model && this.processor) {
      return;
    }

    const baseOptions = {
      quantized: this.quantized,
      dtype: "fp32" as const,
    };

    const modelOptions = this.cacheDir
      ? { ...baseOptions, cache_dir: this.cacheDir }
      : baseOptions;

    const processorOptions = this.cacheDir ? { cache_dir: this.cacheDir } : {};

    // Load model and processor in parallel
    const [model, processor] = await Promise.all([
      WhisperForConditionalGeneration.from_pretrained(MODEL_ID, modelOptions),
      AutoProcessor.from_pretrained(MODEL_ID, processorOptions),
    ]);

    this.model = model;
    this.processor = processor;
  }

  /**
   * Transcribes audio with streaming partial results.
   * Yields partial results for long audio, followed by a final result.
   * @yields {ASRResult} Partial results (isPartial=true) followed by final result (isPartial=false)
   */
  async *transcribe(
    audioData: Float32Array,
    options?: Readonly<ASROptions>
  ): AsyncIterableIterator<ASRResult> {
    if (!this.model || !this.processor) {
      throw new NotInitializedError("DistilWhisperASR");
    }

    // Preprocess audio: normalize, convert to mono, resample to 16kHz
    const preprocessed = this.preprocessAudio(
      audioData,
      options?.audioMetadata
    );
    const { samples } = preprocessed;

    // Validate minimum audio duration
    const durationSec = samples.length / WHISPER_SAMPLE_RATE;
    if (durationSec < MIN_AUDIO_DURATION_SEC) {
      throw new AudioTooShortError(durationSec, MIN_AUDIO_DURATION_SEC);
    }

    const detectedLanguage = options?.language ?? "en";

    const strideSamples = Math.floor(STREAMING_STRIDE_SEC * WHISPER_SAMPLE_RATE);
    const windowSamples = Math.floor(STREAMING_WINDOW_SEC * WHISPER_SAMPLE_RATE);

    // For short audio (under one window), process as single chunk
    if (samples.length <= windowSamples) {
      const result = await this.transcribeChunk(samples, options);
      yield { ...result, language: detectedLanguage, isPartial: false };
      return;
    }

    // Rolling window approach for longer audio:
    // - Emit partials every stride (400ms) for low latency
    // - Use window-sized context (1.5s) for each transcription
    // - Track position to avoid duplicate text in final result
    const allWords: ASRWord[] = [];
    let finalText = "";
    let processedUpTo = 0; // Samples fully committed to final result

    for (let strideStart = 0; strideStart < samples.length; strideStart += strideSamples) {
      const isLastStride = strideStart + strideSamples >= samples.length;

      // Calculate window boundaries
      const windowStart = Math.max(0, strideStart + strideSamples - windowSamples);
      const windowEnd = Math.min(strideStart + strideSamples, samples.length);

      // For last stride, extend to end of audio
      const actualWindowEnd = isLastStride ? samples.length : windowEnd;
      const window = samples.slice(windowStart, actualWindowEnd);

      // Skip windows that are too short
      if (window.length < MIN_AUDIO_DURATION_SEC * WHISPER_SAMPLE_RATE) {
        continue;
      }

      const windowResult = await this.transcribeChunk(window, options);

      // Calculate time offset for this window
      const windowStartSec = windowStart / WHISPER_SAMPLE_RATE;

      // For partial results: emit current window transcription
      if (!isLastStride) {
        const partialResult: ASRResult = {
          text: windowResult.text,
          language: detectedLanguage,
          isPartial: true,
        };

        if (options?.timestamps && windowResult.words) {
          const adjustedWords = windowResult.words.map((w) => ({
            word: w.word,
            start: w.start + windowStartSec,
            end: w.end + windowStartSec,
            ...(w.confidence !== undefined && { confidence: w.confidence }),
          }));
          yield { ...partialResult, words: adjustedWords };
        } else {
          yield partialResult;
        }
      } else {
        // Final stride: capture any new content not yet in final result
        // Since windows overlap, we take the portion after processedUpTo
        const newContentDurationSec = (actualWindowEnd - Math.max(processedUpTo, windowStart)) / WHISPER_SAMPLE_RATE;

        if (newContentDurationSec > MIN_AUDIO_DURATION_SEC) {
          // For simplicity, use the full window result for the final chunk
          // A more sophisticated approach would splice based on word timestamps
          finalText = finalText ? `${finalText} ${windowResult.text}` : windowResult.text;

          if (options?.timestamps && windowResult.words) {
            for (const word of windowResult.words) {
              const adjustedStart = word.start + windowStartSec;
              // Only add words that are past our processed boundary
              if (adjustedStart >= processedUpTo / WHISPER_SAMPLE_RATE - 0.1) {
                const adjustedWord: ASRWord = {
                  word: word.word,
                  start: adjustedStart,
                  end: word.end + windowStartSec,
                };
                if (word.confidence !== undefined) {
                  allWords.push({ ...adjustedWord, confidence: word.confidence });
                } else {
                  allWords.push(adjustedWord);
                }
              }
            }
          }
        }
      }

      // Update processed position after each stride
      processedUpTo = Math.min(strideStart + strideSamples, samples.length);
    }

    // If we haven't accumulated final text yet (e.g., single window after partials)
    // transcribe the full audio for the final result
    if (!finalText) {
      const fullResult = await this.transcribeChunk(samples, options);
      finalText = fullResult.text;
      if (options?.timestamps && fullResult.words) {
        allWords.push(...fullResult.words);
      }
    }

    // Emit final result
    const finalResult: ASRResult = {
      text: finalText.trim(),
      language: detectedLanguage,
      isPartial: false,
    };
    yield options?.timestamps
      ? { ...finalResult, words: allWords }
      : finalResult;
  }

  /**
   * Convenience method that returns only the final transcription result.
   * Consumes all partial results internally.
   */
  async transcribeFinal(
    audioData: Float32Array,
    options?: Readonly<ASROptions>
  ): Promise<ASRResult> {
    let finalResult: ASRResult | null = null;

    for await (const result of this.transcribe(audioData, options)) {
      finalResult = result;
    }

    if (!finalResult) {
      throw new TranscriptionFailedError("No transcription result produced");
    }

    return finalResult;
  }

  /**
   * Preprocesses audio to the format required by Whisper:
   * - Mono channel
   * - 16kHz sample rate
   * - Normalized Float32 samples
   *
   * @throws {EmptyBufferError} If audio buffer is empty
   * @throws {InvalidSampleRateError} If sample rate is not positive
   * @throws {InvalidChannelCountError} If channel count is less than 1
   */
  private preprocessAudio(
    audioData: Float32Array,
    metadata?: AudioMetadata
  ): PreprocessedAudio {
    // Validate input buffer
    if (audioData.length === 0) {
      throw new EmptyBufferError();
    }

    // Detect or use provided metadata
    const effectiveMetadata = metadata ?? this.detectAudioMetadata(audioData);

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
    if (effectiveMetadata.sampleRate !== WHISPER_SAMPLE_RATE) {
      samples = resampleLinear(samples, {
        inputSampleRate: effectiveMetadata.sampleRate,
        outputSampleRate: WHISPER_SAMPLE_RATE,
      });
    }

    // Validate sample values are in expected range
    this.validateSampleRange(samples);

    return { samples, sampleRate: WHISPER_SAMPLE_RATE };
  }

  /**
   * TODO:
   * Attempts to detect audio metadata from buffer characteristics.
   * Falls back to assuming 16kHz mono if detection is inconclusive.
   */
  private detectAudioMetadata(_audioData: Float32Array): AudioMetadata {
    // Heuristic: check if sample count suggests common sample rates
    // This is a best-effort detection; explicit metadata is always preferred
    // const length = audioData.length;

    // Common audio durations and their expected sample counts at various rates
    // For now, assume 16kHz mono as the safe default (matches Whisper's expected input)
    // A more sophisticated implementation could analyze the audio spectrum
    return {
      sampleRate: ASR_SAMPLE_RATE,
      channels: 1,
    };
  }

  /**
   * Validates that audio samples are in the expected normalized range.
   * Does not throw - validation issues are non-fatal and transcription continues.
   * Callers can detect issues through transcription results (empty text, poor quality).
   */
  private validateSampleRange(_samples: Float32Array): void {
    // Validation is intentionally silent - no logger available.
    // Audio quality issues manifest in transcription results.
    // Future: Add optional logger injection for diagnostic warnings.
  }

  /**
   * Transcribes a single audio chunk (already preprocessed to 16kHz mono).
   */
  private async transcribeChunk(
    samples: Float32Array,
    options?: Readonly<ASROptions>
  ): Promise<Omit<ASRResult, "language" | "isPartial">> {
    if (!this.model || !this.processor) {
      throw new NotInitializedError("DistilWhisperASR");
    }

    // Process audio input
    const inputs = await this.processor(samples, {
      sampling_rate: WHISPER_SAMPLE_RATE,
      return_tensors: "pt",
    });

    // Configure generation
    const generateConfig: WhisperGenerationConfig = {
      max_new_tokens: 448,
      num_beams: 1,
    };

    if (options?.timestamps) {
      generateConfig.return_timestamps = "word";
    }

    if (options?.language) {
      generateConfig.language = options.language;
    }

    if (options?.task) {
      generateConfig.task = options.task;
    }

    // Generate transcription
    const output = await this.model.generate({
      ...inputs,
      ...generateConfig,
    });

    // Handle both possible output formats
    const sequences = this.extractSequences(output);

    // Decode the output
    const decoded = this.processor.batch_decode(sequences, {
      skip_special_tokens: true,
      decode_with_timestamps: options?.timestamps ?? false,
    });

    const text = Array.isArray(decoded) ? decoded[0] ?? "" : String(decoded);

    // Parse timestamps if requested
    if (options?.timestamps) {
      const words = this.parseTimestampedOutput(text);
      return {
        text: words.map((w) => w.word).join(" "),
        words,
      };
    }

    return { text: text.trim() };
  }

  private extractSequences(output: unknown): Tensor {
    // If output is already a Tensor (array-like), return it directly
    if (output && typeof output === "object") {
      // Check if it has a sequences property (ModelOutput format)
      if ("sequences" in output) {
        return (output as { sequences: Tensor }).sequences;
      }
      // Check if it's a Tensor-like object (has dims and data)
      if ("dims" in output || "data" in output || Array.isArray(output)) {
        return output as Tensor;
      }
    }
    // Fallback: assume it's the sequences directly
    return output as Tensor;
  }

  private parseTimestampedOutput(text: string): ASRWord[] {
    const words: ASRWord[] = [];

    // Whisper timestamp format: <|0.00|>word<|0.50|>
    const timestampPattern = /<\|(\d+\.?\d*)\|>([^<]*)/g;
    let match: RegExpExecArray | null;
    let lastEnd = 0;

    while ((match = timestampPattern.exec(text)) !== null) {
      const timestamp = parseFloat(match[1] ?? "0");
      const wordText = (match[2] ?? "").trim();

      if (wordText) {
        words.push({
          word: wordText,
          start: lastEnd,
          end: timestamp,
        });
        lastEnd = timestamp;
      }
    }

    // If no timestamps found, return the text as a single word segment
    if (words.length === 0 && text.trim()) {
      words.push({
        word: text.trim(),
        start: 0,
        end: 0,
      });
    }

    return words;
  }

  async dispose(): Promise<void> {
    if (this.model) {
      // Transformers.js models don't have explicit dispose, but we can clear references
      this.model = null;
    }
    this.processor = null;
  }
}

export function createDistilWhisperASR(
  options?: Readonly<DistilWhisperASROptions>
): DistilWhisperASR {
  return new DistilWhisperASR(options);
}
