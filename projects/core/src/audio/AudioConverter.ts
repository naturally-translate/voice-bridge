/**
 * Audio format conversion utilities.
 * Handles PCM/WAV format conversions for audio processing pipelines.
 */

export interface WavHeader {
  readonly sampleRate: number;
  readonly numChannels: number;
  readonly bitsPerSample: number;
  readonly dataLength: number;
}

/**
 * Converts signed 16-bit PCM samples to normalized Float32Array.
 * Output range: [-1.0, 1.0]
 */
export function int16ToFloat32(samples: Int16Array): Float32Array {
  const result = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i] ?? 0;
    result[i] = sample / 32768;
  }
  return result;
}

/**
 * Converts normalized Float32Array to signed 16-bit PCM samples.
 * Input range should be [-1.0, 1.0], values are clamped.
 */
export function float32ToInt16(samples: Float32Array): Int16Array {
  const result = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i] ?? 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    result[i] = Math.round(clamped * 32767);
  }
  return result;
}

/**
 * Converts multi-channel audio to mono by averaging channels.
 */
export function stereoToMono(samples: Float32Array, numChannels: number): Float32Array {
  if (numChannels === 1) {
    return samples;
  }

  const monoLength = Math.floor(samples.length / numChannels);
  const result = new Float32Array(monoLength);

  for (let i = 0; i < monoLength; i++) {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      sum += samples[i * numChannels + ch] ?? 0;
    }
    result[i] = sum / numChannels;
  }

  return result;
}

/**
 * Result of searching for a WAV chunk.
 */
interface ChunkSearchResult {
  readonly found: boolean;
  readonly offset: number;
  readonly size: number;
}

/**
 * Reads a 4-character chunk ID from the buffer at the given offset.
 */
function readChunkId(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

/**
 * Searches for a WAV chunk by ID starting from a given offset.
 * Returns the chunk's data offset and size if found.
 */
function findChunk(
  view: DataView,
  startOffset: number,
  targetChunkId: string
): ChunkSearchResult {
  let offset = startOffset;

  while (offset < view.byteLength - 8) {
    const chunkId = readChunkId(view, offset);
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === targetChunkId) {
      return { found: true, offset: offset + 8, size: chunkSize };
    }

    offset += 8 + chunkSize;
  }

  return { found: false, offset: -1, size: 0 };
}

/**
 * Parses a WAV file header from a buffer.
 * Returns header info or throws if the format is invalid.
 */
export function parseWavHeader(buffer: ArrayBuffer): WavHeader {
  const view = new DataView(buffer);

  // Check RIFF header
  const riff = readChunkId(view, 0);
  if (riff !== 'RIFF') {
    throw new Error('Invalid WAV file: missing RIFF header');
  }

  // Check WAVE format
  const wave = readChunkId(view, 8);
  if (wave !== 'WAVE') {
    throw new Error('Invalid WAV file: missing WAVE format');
  }

  // Find and parse fmt chunk
  const fmtResult = findChunk(view, 12, 'fmt ');
  if (!fmtResult.found) {
    throw new Error('Invalid WAV file: missing fmt chunk');
  }

  const fmtOffset = fmtResult.offset;
  const audioFormat = view.getUint16(fmtOffset, true);
  const numChannels = view.getUint16(fmtOffset + 2, true);
  const sampleRate = view.getUint32(fmtOffset + 4, true);
  const bitsPerSample = view.getUint16(fmtOffset + 14, true);

  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(`Unsupported audio format: ${audioFormat} (only PCM and IEEE float supported)`);
  }

  // Find data chunk (search from after fmt chunk)
  const dataSearchStart = fmtResult.offset + fmtResult.size;
  const dataResult = findChunk(view, dataSearchStart, 'data');

  return {
    sampleRate,
    numChannels,
    bitsPerSample,
    dataLength: dataResult.found ? dataResult.size : 0,
  };
}

/**
 * Extracts raw audio samples from a WAV file as Float32Array.
 * Automatically handles mono conversion.
 */
export function decodeWav(buffer: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const header = parseWavHeader(buffer);
  const view = new DataView(buffer);

  // Find data chunk offset using the helper
  const dataResult = findChunk(view, 12, 'data');
  if (!dataResult.found) {
    throw new Error('Invalid WAV file: missing data chunk');
  }

  const dataOffset = dataResult.offset;
  const bytesPerSample = header.bitsPerSample / 8;
  const numSamples = header.dataLength / bytesPerSample;

  let samples: Float32Array;

  if (header.bitsPerSample === 16) {
    const int16Samples = new Int16Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      int16Samples[i] = view.getInt16(dataOffset + i * 2, true);
    }
    samples = int16ToFloat32(int16Samples);
  } else if (header.bitsPerSample === 32) {
    samples = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      samples[i] = view.getFloat32(dataOffset + i * 4, true);
    }
  } else {
    throw new Error(`Unsupported bits per sample: ${header.bitsPerSample}`);
  }

  // Convert to mono if needed
  const monoSamples = stereoToMono(samples, header.numChannels);

  return {
    samples: monoSamples,
    sampleRate: header.sampleRate,
  };
}

/**
 * Encodes Float32Array samples into a WAV file buffer.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataLength = samples.length * bytesPerSample;
  const fileSize = 44 + dataLength;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, fileSize - 8, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // audio format (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true); // block align
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write samples
  const int16Samples = float32ToInt16(samples);
  for (let i = 0; i < int16Samples.length; i++) {
    view.setInt16(44 + i * 2, int16Samples[i] ?? 0, true);
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
