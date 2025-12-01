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
import {
  preprocessAudio,
  type PreprocessedAudio,
} from "../../audio/AudioPreprocessor.js";
import {
  NotInitializedError,
  EmptyBufferError,
  AudioTooShortError,
  TranscriptionFailedError,
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
    const preprocessed = this.preprocessAudioData(
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
    const windowSamples = Math.floor(STREAMING_WINDOW_SEC * WHISPER_SAMPLE_RATE);

    // For short audio (under one window), process as single chunk
    if (samples.length <= windowSamples) {
      const result = await this.transcribeChunk(samples, options);
      yield { ...result, language: detectedLanguage, isPartial: false };
      return;
    }

    // Use chunked processing for longer audio
    yield* this.transcribeLongAudio(samples, detectedLanguage, options);
  }

  /**
   * Processes long audio using a sliding window approach with partial results.
   * Emits partials after each stride, followed by a final result.
   * @yields {ASRResult} Partial results followed by final result
   */
  private async *transcribeLongAudio(
    samples: Float32Array,
    language: string,
    options?: Readonly<ASROptions>
  ): AsyncIterableIterator<ASRResult> {
    const strideSamples = Math.floor(STREAMING_STRIDE_SEC * WHISPER_SAMPLE_RATE);
    const windowSamples = Math.floor(STREAMING_WINDOW_SEC * WHISPER_SAMPLE_RATE);
    const totalStrides = Math.ceil(samples.length / strideSamples);

    const allWords: ASRWord[] = [];
    const textSegments: string[] = [];

    for (let strideIndex = 0; strideIndex < totalStrides; strideIndex++) {
      const isLastStride = strideIndex === totalStrides - 1;

      const strideResult = await this.processStride(
        samples,
        strideIndex,
        strideSamples,
        windowSamples,
        options
      );

      if (strideResult) {
        textSegments.push(strideResult.text);
        if (strideResult.words) {
          allWords.push(...strideResult.words);
        }
      }

      // Emit partial result (not for last stride)
      if (!isLastStride) {
        yield this.buildResult(textSegments, allWords, language, true, options);
      }
    }

    // Emit final result
    yield this.buildResult(textSegments, allWords, language, false, options);
  }

  /**
   * Processes a single stride of the audio, returning new text and words.
   */
  private async processStride(
    samples: Float32Array,
    strideIndex: number,
    strideSamples: number,
    windowSamples: number,
    options?: Readonly<ASROptions>
  ): Promise<{ text: string; words?: ASRWord[] } | null> {
    const strideStart = strideIndex * strideSamples;
    const strideEnd = Math.min((strideIndex + 1) * strideSamples, samples.length);

    // Window extends back from strideEnd to capture context
    const windowStart = Math.max(0, strideEnd - windowSamples);
    const window = samples.slice(windowStart, strideEnd);

    // Skip windows that are too short
    if (window.length < MIN_AUDIO_DURATION_SEC * WHISPER_SAMPLE_RATE) {
      return null;
    }

    const windowResult = await this.transcribeChunk(window, options);
    const windowStartSec = windowStart / WHISPER_SAMPLE_RATE;
    const strideStartSec = strideStart / WHISPER_SAMPLE_RATE;

    if (strideIndex === 0) {
      return this.processFirstStride(windowResult, windowStartSec, options);
    }

    return this.processSubsequentStride(
      samples,
      windowResult,
      windowStartSec,
      strideStartSec,
      strideStart,
      strideEnd,
      options
    );
  }

  /**
   * Processes the first stride, taking all text from the window.
   */
  private processFirstStride(
    windowResult: Omit<ASRResult, "language" | "isPartial">,
    windowStartSec: number,
    options?: Readonly<ASROptions>
  ): { text: string; words?: ASRWord[] } {
    const words: ASRWord[] = [];

    if (options?.timestamps && windowResult.words) {
      for (const word of windowResult.words) {
        const adjustedWord = this.adjustWordTiming(word, windowStartSec);
        words.push(adjustedWord);
      }
    }

    if (words.length > 0) {
      return { text: windowResult.text, words };
    }
    return { text: windowResult.text };
  }

  /**
   * Processes subsequent strides, extracting only new content.
   */
  private async processSubsequentStride(
    samples: Float32Array,
    windowResult: Omit<ASRResult, "language" | "isPartial">,
    windowStartSec: number,
    strideStartSec: number,
    strideStart: number,
    strideEnd: number,
    options?: Readonly<ASROptions>
  ): Promise<{ text: string; words?: ASRWord[] } | null> {
    if (options?.timestamps && windowResult.words) {
      const newWords: ASRWord[] = [];

      for (const word of windowResult.words) {
        const absoluteStart = word.start + windowStartSec;
        // Only include words starting in the new stride region
        if (absoluteStart >= strideStartSec - 0.1) {
          newWords.push(this.adjustWordTiming(word, windowStartSec));
        }
      }

      if (newWords.length > 0) {
        return {
          text: newWords.map((w) => w.word).join(" "),
          words: newWords,
        };
      }
      return null;
    }

    // Without timestamps, re-transcribe just the new stride portion
    const strideChunk = samples.slice(strideStart, strideEnd);
    if (strideChunk.length >= MIN_AUDIO_DURATION_SEC * WHISPER_SAMPLE_RATE) {
      const strideResult = await this.transcribeChunk(strideChunk, options);
      if (strideResult.text.trim()) {
        return { text: strideResult.text };
      }
    }
    return null;
  }

  /**
   * Adjusts word timing by adding the window start offset.
   */
  private adjustWordTiming(word: ASRWord, offsetSec: number): ASRWord {
    const adjusted: ASRWord = {
      word: word.word,
      start: word.start + offsetSec,
      end: word.end + offsetSec,
    };
    if (word.confidence !== undefined) {
      return { ...adjusted, confidence: word.confidence };
    }
    return adjusted;
  }

  /**
   * Builds an ASRResult from accumulated segments and words.
   */
  private buildResult(
    textSegments: readonly string[],
    allWords: readonly ASRWord[],
    language: string,
    isPartial: boolean,
    options?: Readonly<ASROptions>
  ): ASRResult {
    const text = textSegments.join(" ").trim();
    const result: ASRResult = { text, language, isPartial };

    if (options?.timestamps && allWords.length > 0) {
      return { ...result, words: [...allWords] };
    }
    return result;
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
   * IMPORTANT: If audioMetadata is not provided, 16kHz mono is assumed.
   * For non-16kHz audio, callers MUST provide metadata to ensure correct
   * resampling. Without correct metadata, transcripts will have timing errors
   * and potentially garbled output.
   *
   * @throws {EmptyBufferError} If audio buffer is empty
   * @throws {InvalidSampleRateError} If sample rate is not positive
   * @throws {InvalidChannelCountError} If channel count is less than 1
   */
  private preprocessAudioData(
    audioData: Float32Array,
    metadata: AudioMetadata | undefined
  ): PreprocessedAudio {
    // Validate input buffer - ASR requires non-empty audio
    if (audioData.length === 0) {
      throw new EmptyBufferError();
    }

    return preprocessAudio({
      audioData,
      metadata,
      targetSampleRate: WHISPER_SAMPLE_RATE,
    });
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
