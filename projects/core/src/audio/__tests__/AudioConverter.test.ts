import { describe, it, expect } from "vitest";

import {
  int16ToFloat32,
  float32ToInt16,
  stereoToMono,
  parseWavHeader,
  decodeWav,
  encodeWav,
} from "../AudioConverter.js";

describe("AudioConverter", () => {
  describe("int16ToFloat32()", () => {
    it.each([
      { input: 0, expected: 0, label: "zero to zero" },
      { input: 32767, expected: 1.0, label: "max positive to ~1.0" },
      { input: -32768, expected: -1.0, label: "max negative to ~-1.0" },
      { input: 16384, expected: 0.5, label: "mid positive to ~0.5" },
      { input: -16384, expected: -0.5, label: "mid negative to ~-0.5" },
    ])("converts $label", ({ input, expected }) => {
      const result = int16ToFloat32(new Int16Array([input]));
      expect(result[0]).toBeCloseTo(expected, 2);
    });

    it("handles empty input", () => {
      const result = int16ToFloat32(new Int16Array(0));
      expect(result.length).toBe(0);
    });

    it("preserves sample count", () => {
      const input = new Int16Array(1000);
      const result = int16ToFloat32(input);

      expect(result.length).toBe(1000);
    });
  });

  describe("float32ToInt16()", () => {
    it.each([
      { input: 0, expected: 0, label: "zero to zero" },
      { input: 1.0, expected: 32767, label: "1.0 to max positive" },
      { input: -1.0, expected: -32767, label: "-1.0 to max negative" },
    ])("converts $label", ({ input, expected }) => {
      const result = float32ToInt16(new Float32Array([input]));
      expect(result[0]).toBe(expected);
    });

    it.each([
      { input: 1.5, label: "1.5" },
      { input: 2.0, label: "2.0" },
      { input: 10.0, label: "10.0" },
    ])("clamps $label to max positive (32767)", ({ input }) => {
      const result = float32ToInt16(new Float32Array([input]));
      expect(result[0]).toBe(32767);
    });

    it.each([
      { input: -1.5, label: "-1.5" },
      { input: -2.0, label: "-2.0" },
      { input: -10.0, label: "-10.0" },
    ])("clamps $label to max negative (-32767)", ({ input }) => {
      const result = float32ToInt16(new Float32Array([input]));
      expect(result[0]).toBe(-32767);
    });

    it("handles empty input", () => {
      const result = float32ToInt16(new Float32Array(0));
      expect(result.length).toBe(0);
    });

    it("preserves sample count", () => {
      const input = new Float32Array(1000);
      const result = float32ToInt16(input);

      expect(result.length).toBe(1000);
    });
  });

  describe("int16ToFloat32() and float32ToInt16() round-trip", () => {
    it("round-trips with minimal loss", () => {
      const original = new Int16Array([0, 100, -100, 16384, -16384, 32767, -32768]);
      const floats = int16ToFloat32(original);
      const result = float32ToInt16(floats);

      for (let i = 0; i < original.length; i++) {
        // Allow ±1 for rounding
        expect(Math.abs(result[i]! - original[i]!)).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("stereoToMono()", () => {
    it("returns same array for mono input", () => {
      const mono = new Float32Array([0.1, 0.2, 0.3]);
      const result = stereoToMono(mono, 1);

      expect(result).toBe(mono);
    });

    it("averages stereo channels", () => {
      // Interleaved stereo: [L0, R0, L1, R1, ...]
      const stereo = new Float32Array([0.2, 0.4, 0.6, 0.8]);
      const result = stereoToMono(stereo, 2);

      expect(result.length).toBe(2);
      expect(result[0]).toBeCloseTo(0.3, 5); // (0.2 + 0.4) / 2
      expect(result[1]).toBeCloseTo(0.7, 5); // (0.6 + 0.8) / 2
    });

    it("handles multi-channel audio (5.1)", () => {
      // 6 channels: [C0, C1, C2, C3, C4, C5, C0, C1, ...]
      const sixChannel = new Float32Array([
        0.1, 0.2, 0.3, 0.4, 0.5, 0.6, // Frame 1
        0.6, 0.5, 0.4, 0.3, 0.2, 0.1, // Frame 2
      ]);
      const result = stereoToMono(sixChannel, 6);

      expect(result.length).toBe(2);
      expect(result[0]).toBeCloseTo(0.35, 5); // Average of 0.1-0.6
      expect(result[1]).toBeCloseTo(0.35, 5); // Average of 0.6-0.1
    });

    it("handles empty input", () => {
      const result = stereoToMono(new Float32Array(0), 2);
      expect(result.length).toBe(0);
    });

    it("halves sample count for stereo", () => {
      const stereo = new Float32Array(1000);
      const result = stereoToMono(stereo, 2);

      expect(result.length).toBe(500);
    });
  });

  describe("parseWavHeader()", () => {
    function createMinimalWav(
      sampleRate: number,
      numChannels: number,
      bitsPerSample: number,
      dataLength: number
    ): ArrayBuffer {
      const buffer = new ArrayBuffer(44 + dataLength);
      const view = new DataView(buffer);

      // RIFF header
      view.setUint8(0, 0x52); // R
      view.setUint8(1, 0x49); // I
      view.setUint8(2, 0x46); // F
      view.setUint8(3, 0x46); // F
      view.setUint32(4, 36 + dataLength, true);
      view.setUint8(8, 0x57); // W
      view.setUint8(9, 0x41); // A
      view.setUint8(10, 0x56); // V
      view.setUint8(11, 0x45); // E

      // fmt chunk
      view.setUint8(12, 0x66); // f
      view.setUint8(13, 0x6d); // m
      view.setUint8(14, 0x74); // t
      view.setUint8(15, 0x20); // (space)
      view.setUint32(16, 16, true); // chunk size
      view.setUint16(20, 1, true); // audio format (PCM)
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(
        28,
        sampleRate * numChannels * (bitsPerSample / 8),
        true
      ); // byte rate
      view.setUint16(32, numChannels * (bitsPerSample / 8), true); // block align
      view.setUint16(34, bitsPerSample, true);

      // data chunk
      view.setUint8(36, 0x64); // d
      view.setUint8(37, 0x61); // a
      view.setUint8(38, 0x74); // t
      view.setUint8(39, 0x61); // a
      view.setUint32(40, dataLength, true);

      return buffer;
    }

    it.each([
      { sampleRate: 44100, channels: 2, bits: 16, dataLen: 1000, label: "44.1kHz stereo" },
      { sampleRate: 16000, channels: 1, bits: 16, dataLen: 32000, label: "16kHz mono" },
      { sampleRate: 48000, channels: 2, bits: 16, dataLen: 192000, label: "48kHz stereo" },
    ])("parses $label WAV header", ({ sampleRate, channels, bits, dataLen }) => {
      const wav = createMinimalWav(sampleRate, channels, bits, dataLen);
      const header = parseWavHeader(wav);

      expect(header.sampleRate).toBe(sampleRate);
      expect(header.numChannels).toBe(channels);
      expect(header.bitsPerSample).toBe(bits);
      expect(header.dataLength).toBe(dataLen);
    });

    it("throws for invalid RIFF header", () => {
      const buffer = new ArrayBuffer(44);
      const view = new DataView(buffer);
      view.setUint8(0, 0x00); // Not 'R'

      expect(() => parseWavHeader(buffer)).toThrow("missing RIFF header");
    });

    it("throws for invalid WAVE format", () => {
      const buffer = new ArrayBuffer(44);
      const view = new DataView(buffer);
      // Valid RIFF
      view.setUint8(0, 0x52);
      view.setUint8(1, 0x49);
      view.setUint8(2, 0x46);
      view.setUint8(3, 0x46);
      // Invalid WAVE
      view.setUint8(8, 0x00);

      expect(() => parseWavHeader(buffer)).toThrow("missing WAVE format");
    });
  });

  describe("decodeWav()", () => {
    function createWavWithSamples(
      samples: Float32Array,
      sampleRate: number
    ): ArrayBuffer {
      return encodeWav(samples, sampleRate);
    }

    it("decodes WAV and returns samples with sample rate", () => {
      const original = new Float32Array([0.5, -0.5, 0.25, -0.25]);
      const wav = createWavWithSamples(original, 16000);

      const { samples, sampleRate } = decodeWav(wav);

      expect(sampleRate).toBe(16000);
      expect(samples.length).toBe(original.length);
    });

    it("preserves audio content through encode/decode", () => {
      // Generate a simple sine wave
      const original = new Float32Array(1000);
      for (let i = 0; i < original.length; i++) {
        original[i] = Math.sin((2 * Math.PI * 440 * i) / 16000);
      }

      const wav = encodeWav(original, 16000);
      const { samples } = decodeWav(wav);

      // Should be close (some quantization loss due to 16-bit encoding)
      for (let i = 0; i < original.length; i++) {
        expect(samples[i]).toBeCloseTo(original[i]!, 2);
      }
    });
  });

  describe("encodeWav()", () => {
    it("creates valid WAV buffer", () => {
      const samples = new Float32Array(1000);
      const buffer = encodeWav(samples, 16000);

      // Should be able to parse the header
      const header = parseWavHeader(buffer);

      expect(header.sampleRate).toBe(16000);
      expect(header.numChannels).toBe(1);
      expect(header.bitsPerSample).toBe(16);
      expect(header.dataLength).toBe(2000); // 1000 samples * 2 bytes
    });

    it("creates correct file size", () => {
      const samples = new Float32Array(100);
      const buffer = encodeWav(samples, 16000);

      // 44 bytes header + 200 bytes data (100 samples * 2 bytes)
      expect(buffer.byteLength).toBe(244);
    });

    it("handles empty input", () => {
      const buffer = encodeWav(new Float32Array(0), 16000);

      expect(buffer.byteLength).toBe(44); // Just header
    });

    it("encodes different sample rates correctly", () => {
      const samples = new Float32Array(100);

      const wav44100 = encodeWav(samples, 44100);
      const wav48000 = encodeWav(samples, 48000);

      expect(parseWavHeader(wav44100).sampleRate).toBe(44100);
      expect(parseWavHeader(wav48000).sampleRate).toBe(48000);
    });
  });

  describe("integration: full audio pipeline", () => {
    it("converts stereo 48kHz to mono 16kHz correctly", () => {
      // Create stereo 48kHz audio
      const stereoSamples = 4800; // 50ms at 48kHz
      const stereo = new Float32Array(stereoSamples * 2);

      // Fill with a simple pattern (L=0.5, R=-0.5)
      for (let i = 0; i < stereoSamples; i++) {
        stereo[i * 2] = 0.5; // Left
        stereo[i * 2 + 1] = -0.5; // Right
      }

      // Convert to mono
      const mono = stereoToMono(stereo, 2);
      expect(mono.length).toBe(stereoSamples);

      // Average should be 0
      for (const sample of mono) {
        expect(sample).toBeCloseTo(0, 5);
      }
    });

    it("round-trips audio through WAV encoding", () => {
      // Generate test audio
      const original = new Float32Array(1600); // 100ms at 16kHz
      for (let i = 0; i < original.length; i++) {
        original[i] = 0.8 * Math.sin((2 * Math.PI * 440 * i) / 16000);
      }

      // Encode to WAV
      const wavBuffer = encodeWav(original, 16000);

      // Decode back
      const { samples, sampleRate } = decodeWav(wavBuffer);

      expect(sampleRate).toBe(16000);
      expect(samples.length).toBe(original.length);

      // Verify content (allowing for 16-bit quantization)
      for (let i = 0; i < original.length; i++) {
        expect(samples[i]).toBeCloseTo(original[i]!, 2);
      }
    });
  });
});
