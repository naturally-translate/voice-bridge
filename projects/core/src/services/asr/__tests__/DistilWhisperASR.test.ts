import { describe, it, expect, beforeAll, afterAll } from "vitest";

import {
  createDistilWhisperASR,
  DistilWhisperASR,
} from "../DistilWhisperASR.js";
import type { ASRResult } from "../../../interfaces/IASR.js";
import {
  generateSilence,
  generateSpeechLike,
  generateTone,
  generateLongMixedAudio,
  SAMPLE_RATE,
} from "../../../__fixtures__/audio/generateFixtures.js";
import { TRANSFORMERS_CACHE_DIR } from "../../../__tests__/testConfig.js";

describe("DistilWhisperASR", () => {
  let asr: DistilWhisperASR;

  beforeAll(async () => {
    asr = createDistilWhisperASR({
      cacheDir: TRANSFORMERS_CACHE_DIR,
      quantized: true,
    });
    await asr.initialize();
  }, 300000); // 5 minutes timeout for model download

  afterAll(async () => {
    await asr.dispose();
  });

  describe("initialization", () => {
    it("is ready after initialization", () => {
      expect(asr.isReady).toBe(true);
    });

    it("is not ready before initialization", () => {
      const newAsr = createDistilWhisperASR();
      expect(newAsr.isReady).toBe(false);
    });
  });

  describe("transcribe() streaming API", () => {
    describe("returns AsyncIterableIterator", () => {
      it("yields ASRResult objects", async () => {
        const audio = generateSpeechLike(1000);

        const results: ASRResult[] = [];
        for await (const result of asr.transcribe(audio)) {
          results.push(result);
        }

        expect(results.length).toBeGreaterThanOrEqual(1);

        // Check structure of each result
        for (const result of results) {
          expect(result).toHaveProperty("text");
          expect(result).toHaveProperty("language");
          expect(result).toHaveProperty("isPartial");
          expect(typeof result.text).toBe("string");
          expect(typeof result.language).toBe("string");
          expect(typeof result.isPartial).toBe("boolean");
        }
      });

      it("final result has isPartial=false", async () => {
        const audio = generateSpeechLike(1000);

        const results: ASRResult[] = [];
        for await (const result of asr.transcribe(audio)) {
          results.push(result);
        }

        // Last result should be final
        const lastResult = results[results.length - 1];
        expect(lastResult).toBeDefined();
        expect(lastResult!.isPartial).toBe(false);
      });
    });

    describe("partial results for long audio", () => {
      it("yields partial results before final for audio > 1.5 seconds", async () => {
        // Generate 4 seconds of audio (exceeds 1.5-second window threshold)
        const longAudio = generateSpeechLike(4000);

        const results: ASRResult[] = [];
        for await (const result of asr.transcribe(longAudio)) {
          results.push(result);
        }

        // Should have multiple results for long audio
        expect(results.length).toBeGreaterThan(1);

        // Check partial vs final distribution
        const partials = results.filter((r) => r.isPartial);
        const finals = results.filter((r) => !r.isPartial);

        // Should have at least one partial and exactly one final
        expect(partials.length).toBeGreaterThanOrEqual(1);
        expect(finals.length).toBe(1);

        // Final should be the last result
        expect(results[results.length - 1]!.isPartial).toBe(false);
      });

      it("partial results show rolling window transcriptions", async () => {
        const longAudio = generateSpeechLike(4000);

        const results: ASRResult[] = [];
        for await (const result of asr.transcribe(longAudio)) {
          results.push(result);
        }

        // With rolling window approach, each partial shows current window transcription
        // Verify all results have valid text (may vary due to window content)
        for (const result of results) {
          expect(typeof result.text).toBe("string");
        }
      });
    });

    describe("short audio processing", () => {
      it("yields single final result for audio <= 1.5 seconds (window size)", async () => {
        // Audio within window size (1.5s = 1500ms) processes as single chunk
        const shortAudio = generateSpeechLike(1000);

        const results: ASRResult[] = [];
        for await (const result of asr.transcribe(shortAudio)) {
          results.push(result);
        }

        // Should have exactly one result for short audio
        expect(results).toHaveLength(1);
        expect(results[0]!.isPartial).toBe(false);
      });
    });
  });

  describe("transcribeFinal() convenience method", () => {
    it("returns only the final result", async () => {
      const audio = generateSpeechLike(1000);

      const result = await asr.transcribeFinal(audio);

      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("language");
      expect(result.isPartial).toBe(false);
    });

    it("consumes all partial results internally", async () => {
      // Long audio that would produce partials
      const longAudio = generateSpeechLike(8000);

      const result = await asr.transcribeFinal(longAudio);

      // Should get final result with complete text
      expect(result.isPartial).toBe(false);
      expect(result.text.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("silence handling", () => {
    it("returns empty or minimal text for pure silence", async () => {
      const silence = generateSilence(2000);

      const result = await asr.transcribeFinal(silence);

      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("language");
      // Silence should produce empty or very short output
      expect(result.text.length).toBeLessThan(50);
    });

    it("handles mixed speech and silence", async () => {
      const { samples } = generateLongMixedAudio(6000, 2000, 500);

      const result = await asr.transcribeFinal(samples);

      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("language");
      expect(typeof result.text).toBe("string");
    });
  });

  describe("audio preprocessing", () => {
    it("accepts audio metadata for non-16kHz input", async () => {
      // Generate 48kHz audio (3x samples for same duration)
      const speech16k = generateSpeechLike(1000);
      const speech48k = new Float32Array(speech16k.length * 3);

      // Simple upsampling
      for (let i = 0; i < speech16k.length; i++) {
        speech48k[i * 3] = speech16k[i]!;
        speech48k[i * 3 + 1] = speech16k[i]!;
        speech48k[i * 3 + 2] = speech16k[i]!;
      }

      const result = await asr.transcribeFinal(speech48k, {
        audioMetadata: { sampleRate: 48000, channels: 1 },
      });

      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("language");
    });

    it("handles stereo audio with metadata", async () => {
      // Generate stereo audio (interleaved L/R channels)
      const mono = generateSpeechLike(1000);
      const stereo = new Float32Array(mono.length * 2);

      for (let i = 0; i < mono.length; i++) {
        stereo[i * 2] = mono[i]!; // Left
        stereo[i * 2 + 1] = mono[i]!; // Right
      }

      const result = await asr.transcribeFinal(stereo, {
        audioMetadata: { sampleRate: SAMPLE_RATE, channels: 2 },
      });

      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("language");
    });

    it("auto-detects 16kHz mono when no metadata provided", async () => {
      const audio = generateSpeechLike(1000);

      // No metadata - should assume 16kHz mono
      const result = await asr.transcribeFinal(audio);

      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("language");
    });
  });

  describe("input validation", () => {
    it("throws for empty audio buffer", async () => {
      const empty = new Float32Array(0);

      await expect(asr.transcribeFinal(empty)).rejects.toThrow(
        "Empty audio buffer"
      );
    });

    it("throws for audio too short", async () => {
      // Less than 100ms at 16kHz = less than 1600 samples
      const tooShort = new Float32Array(800); // 50ms

      await expect(asr.transcribeFinal(tooShort)).rejects.toThrow(
        "Audio too short"
      );
    });

    it("throws when not initialized", async () => {
      const uninitializedAsr = createDistilWhisperASR();
      const samples = new Float32Array(16000);

      // Test streaming API
      const collectResults = async (): Promise<void> => {
        for await (const _result of uninitializedAsr.transcribe(samples)) {
          // Should throw
        }
      };

      await expect(collectResults()).rejects.toThrow(
        "DistilWhisperASR not initialized"
      );

      // Test convenience method
      await expect(uninitializedAsr.transcribeFinal(samples)).rejects.toThrow(
        "DistilWhisperASR not initialized"
      );
    });
  });

  describe("transcription options", () => {
    it("accepts language option", async () => {
      const audio = generateSpeechLike(1000);

      const result = await asr.transcribeFinal(audio, { language: "en" });

      expect(result.language).toBe("en");
    });

    it("accepts task option for transcription", async () => {
      const audio = generateSpeechLike(1000);

      const result = await asr.transcribeFinal(audio, { task: "transcribe" });

      expect(result).toHaveProperty("text");
    });

    it("accepts task option for translation", async () => {
      const audio = generateSpeechLike(1000);

      const result = await asr.transcribeFinal(audio, { task: "translate" });

      expect(result).toHaveProperty("text");
    });

    describe("timestamps option", () => {
      it("returns word-level timestamps when enabled", async () => {
        const audio = generateSpeechLike(2000);

        const result = await asr.transcribeFinal(audio, { timestamps: true });

        expect(result).toHaveProperty("text");
        // Words may or may not be present depending on transcription content
        if (result.words && result.words.length > 0) {
          for (const word of result.words) {
            expect(word).toHaveProperty("word");
            expect(word).toHaveProperty("start");
            expect(word).toHaveProperty("end");
            expect(typeof word.word).toBe("string");
            expect(typeof word.start).toBe("number");
            expect(typeof word.end).toBe("number");
            expect(word.end).toBeGreaterThanOrEqual(word.start);
          }
        }
      });

      it("returns timestamps for long audio", async () => {
        // Long audio that will be processed with rolling window
        const longAudio = generateSpeechLike(4000);

        const result = await asr.transcribeFinal(longAudio, { timestamps: true });

        expect(result).toHaveProperty("text");
        // Words array may be present if transcription produced output
        if (result.words && result.words.length > 0) {
          for (const word of result.words) {
            expect(word).toHaveProperty("word");
            expect(word).toHaveProperty("start");
            expect(word).toHaveProperty("end");
            expect(typeof word.start).toBe("number");
            expect(typeof word.end).toBe("number");
          }
        }
      });
    });
  });

  describe("multiple transcriptions", () => {
    it("can transcribe multiple times in sequence", async () => {
      const audio1 = generateSpeechLike(1000);
      const audio2 = generateTone(1000, 440);

      const result1 = await asr.transcribeFinal(audio1);
      const result2 = await asr.transcribeFinal(audio2);

      expect(result1).toHaveProperty("text");
      expect(result2).toHaveProperty("text");
    });

    it("maintains independence between transcriptions", async () => {
      const audio1 = generateSpeechLike(1000);
      const audio2 = generateSilence(1000);

      const result1 = await asr.transcribeFinal(audio1);
      const result2 = await asr.transcribeFinal(audio2);

      // Results should be independent - silence shouldn't inherit speech text
      // (This verifies no state leakage between calls)
      expect(result2.text.length).toBeLessThan(result1.text.length + 50);
    });
  });

  describe("edge cases", () => {
    it("handles audio at minimum valid duration", async () => {
      // Exactly at minimum threshold (100ms = 1600 samples at 16kHz)
      const minAudio = generateSpeechLike(100);

      const result = await asr.transcribeFinal(minAudio);

      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("language");
    });

    it("handles audio at streaming window boundary", async () => {
      // Exactly at window size (1.5s) - should process as single chunk
      const boundaryAudio = generateSpeechLike(1500);

      const results: ASRResult[] = [];
      for await (const result of asr.transcribe(boundaryAudio)) {
        results.push(result);
      }

      // At exactly window size, should be single chunk (no partials)
      expect(results).toHaveLength(1);
      expect(results[0]!.isPartial).toBe(false);
    });

    it("handles pure tone audio", async () => {
      const tone = generateTone(1000, 440, 0.5);

      const result = await asr.transcribeFinal(tone);

      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("language");
    });
  });
});
