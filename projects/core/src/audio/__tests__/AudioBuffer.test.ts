import { describe, it, expect, beforeEach } from "vitest";

import { AudioBuffer } from "../AudioBuffer.js";

describe("AudioBuffer", () => {
  describe("construction", () => {
    it("creates buffer with specified capacity", () => {
      const buffer = new AudioBuffer(1000);
      expect(buffer.maxCapacity).toBe(1000);
    });

    it("starts with size of 0", () => {
      const buffer = new AudioBuffer(1000);
      expect(buffer.size).toBe(0);
    });

    it("starts with freeSpace equal to capacity", () => {
      const buffer = new AudioBuffer(1000);
      expect(buffer.freeSpace).toBe(1000);
    });

    it.each([
      { capacity: 0, label: "zero" },
      { capacity: -100, label: "negative" },
    ])("throws for $label capacity", ({ capacity }) => {
      expect(() => new AudioBuffer(capacity)).toThrow("capacity must be positive");
    });
  });

  describe("write()", () => {
    let buffer: AudioBuffer;

    beforeEach(() => {
      buffer = new AudioBuffer(100);
    });

    describe("when writing 3 samples to empty buffer", () => {
      let written: number;

      beforeEach(() => {
        written = buffer.write(new Float32Array([0.1, 0.2, 0.3]));
      });

      it("returns 3 as number written", () => {
        expect(written).toBe(3);
      });

      it("updates size to 3", () => {
        expect(buffer.size).toBe(3);
      });

      it("updates freeSpace to 97", () => {
        expect(buffer.freeSpace).toBe(97);
      });
    });

    describe("when buffer is nearly full (90/100)", () => {
      let written: number;

      beforeEach(() => {
        buffer.write(new Float32Array(90));
        written = buffer.write(new Float32Array(20));
      });

      it("returns 10 for partial write", () => {
        expect(written).toBe(10);
      });

      it("fills buffer to capacity", () => {
        expect(buffer.size).toBe(100);
      });

      it("leaves no free space", () => {
        expect(buffer.freeSpace).toBe(0);
      });
    });

    it("returns 0 when buffer is full", () => {
      buffer.write(new Float32Array(100));
      expect(buffer.write(new Float32Array(10))).toBe(0);
    });

    it("returns 0 for empty input", () => {
      expect(buffer.write(new Float32Array(0))).toBe(0);
    });

    it("does not change size for empty input", () => {
      buffer.write(new Float32Array(0));
      expect(buffer.size).toBe(0);
    });
  });

  describe("read()", () => {
    let buffer: AudioBuffer;

    beforeEach(() => {
      buffer = new AudioBuffer(100);
    });

    describe("when reading 3 samples from buffer with [0.1, 0.2, 0.3, 0.4, 0.5]", () => {
      let output: Float32Array;

      beforeEach(() => {
        buffer.write(new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]));
        output = buffer.read(3);
      });

      it("returns array of length 3", () => {
        expect(output.length).toBe(3);
      });

      it.each([
        { index: 0, expected: 0.1 },
        { index: 1, expected: 0.2 },
        { index: 2, expected: 0.3 },
      ])("returns $expected at index $index", ({ index, expected }) => {
        expect(output[index]).toBeCloseTo(expected, 5);
      });
    });

    describe("after reading 20 from buffer with 50 samples", () => {
      beforeEach(() => {
        buffer.write(new Float32Array(50));
        buffer.read(20);
      });

      it("updates size to 30", () => {
        expect(buffer.size).toBe(30);
      });

      it("updates freeSpace to 70", () => {
        expect(buffer.freeSpace).toBe(70);
      });
    });

    describe("when requesting more than available", () => {
      let output: Float32Array;

      beforeEach(() => {
        buffer.write(new Float32Array(10));
        output = buffer.read(20);
      });

      it("returns only available samples", () => {
        expect(output.length).toBe(10);
      });

      it("empties the buffer", () => {
        expect(buffer.size).toBe(0);
      });
    });

    it("returns empty array when buffer is empty", () => {
      expect(buffer.read(10).length).toBe(0);
    });

    it("returns empty array for zero count", () => {
      buffer.write(new Float32Array(10));
      expect(buffer.read(0).length).toBe(0);
    });
  });

  describe("peek()", () => {
    let buffer: AudioBuffer;

    beforeEach(() => {
      buffer = new AudioBuffer(100);
    });

    describe("when peeking 2 samples from buffer with [0.1, 0.2, 0.3]", () => {
      let peeked: Float32Array;

      beforeEach(() => {
        buffer.write(new Float32Array([0.1, 0.2, 0.3]));
        peeked = buffer.peek(2);
      });

      it("returns array of length 2", () => {
        expect(peeked.length).toBe(2);
      });

      it("returns 0.1 at index 0", () => {
        expect(peeked[0]).toBeCloseTo(0.1, 5);
      });

      it("returns 0.2 at index 1", () => {
        expect(peeked[1]).toBeCloseTo(0.2, 5);
      });

      it("does not consume samples (size remains 3)", () => {
        expect(buffer.size).toBe(3);
      });
    });

    it("returns same data as subsequent read", () => {
      buffer.write(new Float32Array([0.1, 0.2, 0.3]));
      const peeked = buffer.peek(3);
      const read = buffer.read(3);
      expect(peeked).toEqual(read);
    });

    it("returns only available samples when requesting more", () => {
      buffer.write(new Float32Array(5));
      expect(buffer.peek(10).length).toBe(5);
    });

    it("returns empty array when buffer is empty", () => {
      expect(buffer.peek(10).length).toBe(0);
    });
  });

  describe("discard()", () => {
    let buffer: AudioBuffer;

    beforeEach(() => {
      buffer = new AudioBuffer(100);
    });

    describe("when discarding 20 from buffer with 50 samples", () => {
      let discarded: number;

      beforeEach(() => {
        buffer.write(new Float32Array(50));
        discarded = buffer.discard(20);
      });

      it("returns 20 as discarded count", () => {
        expect(discarded).toBe(20);
      });

      it("reduces size to 30", () => {
        expect(buffer.size).toBe(30);
      });
    });

    describe("when discarding more than available", () => {
      let discarded: number;

      beforeEach(() => {
        buffer.write(new Float32Array(10));
        discarded = buffer.discard(20);
      });

      it("returns only available count (10)", () => {
        expect(discarded).toBe(10);
      });

      it("empties the buffer", () => {
        expect(buffer.size).toBe(0);
      });
    });

    it("returns 0 for empty buffer", () => {
      expect(buffer.discard(10)).toBe(0);
    });
  });

  describe("clear()", () => {
    describe("after clearing a buffer with 50 samples", () => {
      let buffer: AudioBuffer;

      beforeEach(() => {
        buffer = new AudioBuffer(100);
        buffer.write(new Float32Array(50));
        buffer.clear();
      });

      it("resets size to 0", () => {
        expect(buffer.size).toBe(0);
      });

      it("restores freeSpace to capacity", () => {
        expect(buffer.freeSpace).toBe(100);
      });
    });

    describe("after clearing a full buffer", () => {
      let buffer: AudioBuffer;
      let written: number;

      beforeEach(() => {
        buffer = new AudioBuffer(100);
        buffer.write(new Float32Array(100));
        buffer.clear();
        written = buffer.write(new Float32Array(50));
      });

      it("allows writing 50 samples", () => {
        expect(written).toBe(50);
      });

      it("updates size to 50", () => {
        expect(buffer.size).toBe(50);
      });
    });
  });

  describe("hasAvailable()", () => {
    let buffer: AudioBuffer;

    beforeEach(() => {
      buffer = new AudioBuffer(100);
    });

    describe("with 50 samples in buffer", () => {
      beforeEach(() => {
        buffer.write(new Float32Array(50));
      });

      it.each([
        { count: 50, expected: true },
        { count: 30, expected: true },
        { count: 1, expected: true },
        { count: 51, expected: false },
        { count: 100, expected: false },
      ])("returns $expected for hasAvailable($count)", ({ count, expected }) => {
        expect(buffer.hasAvailable(count)).toBe(expected);
      });
    });

    it("returns true for zero when buffer is empty", () => {
      expect(buffer.hasAvailable(0)).toBe(true);
    });

    it("returns false for any positive count when buffer is empty", () => {
      expect(buffer.hasAvailable(1)).toBe(false);
    });
  });

  describe("circular behavior", () => {
    describe("wrap-around scenario: write 8, read 6, write 6, read 8", () => {
      let output: Float32Array;

      beforeEach(() => {
        const buffer = new AudioBuffer(10);
        buffer.write(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]));
        buffer.read(6);
        buffer.write(new Float32Array([9, 10, 11, 12, 13, 14]));
        output = buffer.read(8);
      });

      it("returns 8 samples", () => {
        expect(output.length).toBe(8);
      });

      it("returns correct wrapped sequence [7,8,9,10,11,12,13,14]", () => {
        expect(Array.from(output)).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
      });
    });

    it("maintains data integrity through 10 wrap-around cycles", () => {
      const buffer = new AudioBuffer(5);
      const results: boolean[] = [];

      for (let round = 0; round < 10; round++) {
        buffer.write(new Float32Array([round, round, round]));
        const output = buffer.read(3);
        results.push(
          output.length === 3 &&
          output[0] === round &&
          output[1] === round &&
          output[2] === round
        );
      }

      expect(results.every(Boolean)).toBe(true);
    });
  });

  describe("streaming audio simulation", () => {
    describe("typical streaming: write 5 chunks, read 3 chunks", () => {
      const chunkSize = 160;
      let buffer: AudioBuffer;

      beforeEach(() => {
        buffer = new AudioBuffer(chunkSize * 10);
        for (let i = 0; i < 5; i++) {
          buffer.write(new Float32Array(chunkSize).fill(i / 10));
        }
      });

      it("has size of 5 chunks after writing", () => {
        expect(buffer.size).toBe(chunkSize * 5);
      });

      it("has size of 2 chunks after reading 3", () => {
        for (let i = 0; i < 3; i++) {
          buffer.read(chunkSize);
        }
        expect(buffer.size).toBe(chunkSize * 2);
      });

      it.each([
        { chunkIndex: 0, expected: 0 },
        { chunkIndex: 1, expected: 0.1 },
        { chunkIndex: 2, expected: 0.2 },
      ])("chunk $chunkIndex starts with value ~$expected", ({ chunkIndex, expected }) => {
        // Skip to the target chunk
        for (let i = 0; i < chunkIndex; i++) {
          buffer.read(chunkSize);
        }
        const output = buffer.read(chunkSize);
        expect(output[0]).toBeCloseTo(expected, 5);
      });
    });

    describe("overflow prevention with fast producer", () => {
      let buffer: AudioBuffer;
      let totalWritten: number;
      let totalRead: number;

      beforeEach(() => {
        buffer = new AudioBuffer(1000);
        totalWritten = 0;
        totalRead = 0;

        for (let i = 0; i < 100; i++) {
          totalWritten += buffer.write(new Float32Array(15));
          totalRead += buffer.read(10).length;
        }
      });

      it("reads less than or equal to written amount", () => {
        expect(totalRead).toBeLessThanOrEqual(totalWritten);
      });

      it("keeps buffer at or below capacity", () => {
        expect(buffer.size).toBeLessThanOrEqual(buffer.maxCapacity);
      });
    });
  });
});
