import { describe, it, expect, beforeEach } from "vitest";

import {
  resampleLinear,
  resampleForASR,
  resampleForVAD,
  StreamingResampler,
  ASR_SAMPLE_RATE,
  VAD_SAMPLE_RATE,
} from "../AudioResampler.js";

describe("AudioResampler", () => {
  describe("resampleLinear()", () => {
    describe("identity resampling", () => {
      it("returns same samples when input and output rates match", () => {
        const samples = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
        const result = resampleLinear(samples, {
          inputSampleRate: 16000,
          outputSampleRate: 16000,
        });

        expect(result).toBe(samples); // Should return same reference
      });
    });

    describe("downsampling", () => {
      it("reduces sample count when downsampling 48kHz to 16kHz", () => {
        // 48000 samples at 48kHz = 1 second
        // Should become ~16000 samples at 16kHz
        const input = new Float32Array(48000);
        for (let i = 0; i < input.length; i++) {
          input[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
        }

        const result = resampleLinear(input, {
          inputSampleRate: 48000,
          outputSampleRate: 16000,
        });

        expect(result.length).toBe(16000);
      });

      it("reduces sample count when downsampling 44.1kHz to 16kHz", () => {
        const input = new Float32Array(44100);
        const result = resampleLinear(input, {
          inputSampleRate: 44100,
          outputSampleRate: 16000,
        });

        // 44100 / 16000 * 16000 = ~16000
        expect(result.length).toBeCloseTo(16000, -2); // Within 100 samples
      });

      describe("signal preservation after downsampling 48kHz→16kHz", () => {
        let result: Float32Array;

        beforeEach(() => {
          const inputRate = 48000;
          const outputRate = 16000;
          const frequency = 200;
          const duration = 0.1;

          const input = new Float32Array(inputRate * duration);
          for (let i = 0; i < input.length; i++) {
            input[i] = Math.sin((2 * Math.PI * frequency * i) / inputRate);
          }

          result = resampleLinear(input, {
            inputSampleRate: inputRate,
            outputSampleRate: outputRate,
          });
        });

        it("preserves positive peaks (values > 0.5)", () => {
          expect(result.some((s) => s > 0.5)).toBe(true);
        });

        it("preserves negative peaks (values < -0.5)", () => {
          expect(result.some((s) => s < -0.5)).toBe(true);
        });
      });
    });

    describe("upsampling", () => {
      it("increases sample count when upsampling 16kHz to 48kHz", () => {
        const input = new Float32Array(16000);
        for (let i = 0; i < input.length; i++) {
          input[i] = Math.sin((2 * Math.PI * 440 * i) / 16000);
        }

        const result = resampleLinear(input, {
          inputSampleRate: 16000,
          outputSampleRate: 48000,
        });

        expect(result.length).toBe(48000);
      });

      describe("interpolation of step function [0,0,1,1] upsampled 1→4", () => {
        let result: Float32Array;

        beforeEach(() => {
          result = resampleLinear(new Float32Array([0, 0, 1, 1]), {
            inputSampleRate: 1,
            outputSampleRate: 4,
          });
        });

        it("produces 16 output samples", () => {
          expect(result.length).toBe(16);
        });

        it("starts near 0", () => {
          expect(result[0]).toBeCloseTo(0, 1);
        });

        it("ends near 1", () => {
          expect(result[result.length - 1]).toBeCloseTo(1, 1);
        });

        it("has transitional values in middle (between 0.2 and 0.8)", () => {
          const midSamples = Array.from(result.slice(4, 12));
          expect(midSamples.some((s) => s > 0.2 && s < 0.8)).toBe(true);
        });
      });
    });

    describe("edge cases", () => {
      it("handles empty input", () => {
        const result = resampleLinear(new Float32Array(0), {
          inputSampleRate: 48000,
          outputSampleRate: 16000,
        });

        expect(result.length).toBe(0);
      });

      it("handles single sample input", () => {
        const result = resampleLinear(new Float32Array([0.5]), {
          inputSampleRate: 48000,
          outputSampleRate: 16000,
        });

        // Single sample at 48kHz resampled to 16kHz (ratio 3:1)
        expect(result.length).toBe(0); // Floor(1/3) = 0
      });

      it.each([
        { inputRate: 0, outputRate: 16000, label: "zero input sample rate" },
        { inputRate: 48000, outputRate: 0, label: "zero output sample rate" },
        { inputRate: -48000, outputRate: 16000, label: "negative input sample rate" },
        { inputRate: 48000, outputRate: -16000, label: "negative output sample rate" },
      ])("throws for $label", ({ inputRate, outputRate }) => {
        expect(() =>
          resampleLinear(new Float32Array(100), {
            inputSampleRate: inputRate,
            outputSampleRate: outputRate,
          })
        ).toThrow("Sample rates must be positive");
      });
    });

    describe("precision", () => {
      it("maintains amplitude within expected range", () => {
        const input = new Float32Array(48000);
        for (let i = 0; i < input.length; i++) {
          input[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
        }

        const result = resampleLinear(input, {
          inputSampleRate: 48000,
          outputSampleRate: 16000,
        });

        // All samples should be within [-1, 1]
        for (const sample of result) {
          expect(sample).toBeGreaterThanOrEqual(-1);
          expect(sample).toBeLessThanOrEqual(1);
        }
      });
    });
  });

  describe("resampleForASR()", () => {
    it("resamples to 16kHz", () => {
      const input = new Float32Array(48000); // 1 second at 48kHz
      const result = resampleForASR(input, 48000);

      expect(result.length).toBe(ASR_SAMPLE_RATE);
    });

    it("returns same samples if already 16kHz", () => {
      const input = new Float32Array(16000);
      const result = resampleForASR(input, 16000);

      expect(result).toBe(input);
    });
  });

  describe("resampleForVAD()", () => {
    it("resamples to 16kHz", () => {
      const input = new Float32Array(44100); // 1 second at 44.1kHz
      const result = resampleForVAD(input, 44100);

      expect(result.length).toBeCloseTo(VAD_SAMPLE_RATE, -2);
    });

    it("returns same samples if already 16kHz", () => {
      const input = new Float32Array(16000);
      const result = resampleForVAD(input, 16000);

      expect(result).toBe(input);
    });
  });

  describe("StreamingResampler", () => {
    let resampler: StreamingResampler;

    beforeEach(() => {
      resampler = new StreamingResampler({
        inputSampleRate: 48000,
        outputSampleRate: 16000,
      });
    });

    describe("construction", () => {
      it("exposes output sample rate", () => {
        expect(resampler.sampleRate).toBe(16000);
      });

      it("throws for invalid sample rates", () => {
        expect(
          () =>
            new StreamingResampler({
              inputSampleRate: 0,
              outputSampleRate: 16000,
            })
        ).toThrow("Sample rates must be positive");
      });
    });

    describe("process()", () => {
      it("resamples chunks correctly", () => {
        // Process 480 samples at 48kHz (10ms) -> should get ~160 samples at 16kHz
        const chunk = new Float32Array(480);
        for (let i = 0; i < chunk.length; i++) {
          chunk[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
        }

        const result = resampler.process(chunk);

        expect(result.length).toBe(160);
      });

      it("handles empty chunks", () => {
        const result = resampler.process(new Float32Array(0));
        expect(result.length).toBe(0);
      });

      describe("chunked vs single-pass continuity", () => {
        let chunkedOutput: Float32Array;
        let singlePassOutput: Float32Array;

        beforeEach(() => {
          const totalSamples = 4800;
          const chunkSize = 480;
          const frequency = 440;

          const fullSignal = new Float32Array(totalSamples);
          for (let i = 0; i < totalSamples; i++) {
            fullSignal[i] = Math.sin((2 * Math.PI * frequency * i) / 48000);
          }

          // Process in chunks
          const outputChunks: Float32Array[] = [];
          for (let i = 0; i < totalSamples; i += chunkSize) {
            outputChunks.push(resampler.process(fullSignal.slice(i, i + chunkSize)));
          }

          // Concatenate output
          const totalOutput = outputChunks.reduce((a, b) => a + b.length, 0);
          chunkedOutput = new Float32Array(totalOutput);
          let offset = 0;
          for (const chunk of outputChunks) {
            chunkedOutput.set(chunk, offset);
            offset += chunk.length;
          }

          singlePassOutput = resampleLinear(fullSignal, {
            inputSampleRate: 48000,
            outputSampleRate: 16000,
          });
        });

        it("produces same length as single-pass (within 1 sample)", () => {
          const lengthDifference = Math.abs(chunkedOutput.length - singlePassOutput.length);
          expect(lengthDifference).toBeLessThanOrEqual(1);
        });

        it("produces values matching single-pass output", () => {
          const minLength = Math.min(chunkedOutput.length, singlePassOutput.length);
          const allClose = Array.from({ length: minLength }).every((_, i) =>
            Math.abs((chunkedOutput[i] ?? 0) - (singlePassOutput[i] ?? 0)) < 0.01
          );
          expect(allClose).toBe(true);
        });
      });

      it("produces correct total output length over multiple chunks", () => {
        // 10 chunks of 480 samples = 4800 samples at 48kHz
        // Should produce ~1600 samples at 16kHz
        let totalOutput = 0;

        for (let c = 0; c < 10; c++) {
          const chunk = new Float32Array(480);
          totalOutput += resampler.process(chunk).length;
        }

        expect(totalOutput).toBe(1600);
      });
    });

    describe("reset()", () => {
      describe("after reset, processing same chunk as fresh resampler", () => {
        let resetResult: Float32Array;
        let freshResult: Float32Array;

        beforeEach(() => {
          resampler.process(new Float32Array(480));
          resampler.reset();

          const chunk = new Float32Array(480);
          for (let i = 0; i < chunk.length; i++) {
            chunk[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
          }

          const freshResampler = new StreamingResampler({
            inputSampleRate: 48000,
            outputSampleRate: 16000,
          });

          resetResult = resampler.process(chunk);
          freshResult = freshResampler.process(chunk);
        });

        it("produces same length as fresh resampler", () => {
          expect(resetResult.length).toBe(freshResult.length);
        });

        it("produces same values as fresh resampler", () => {
          const allClose = Array.from({ length: resetResult.length }).every((_, i) =>
            Math.abs((resetResult[i] ?? 0) - (freshResult[i] ?? 0)) < 0.00001
          );
          expect(allClose).toBe(true);
        });
      });
    });
  });

  describe("constants", () => {
    it("ASR_SAMPLE_RATE is 16000", () => {
      expect(ASR_SAMPLE_RATE).toBe(16000);
    });

    it("VAD_SAMPLE_RATE is 16000", () => {
      expect(VAD_SAMPLE_RATE).toBe(16000);
    });
  });
});
