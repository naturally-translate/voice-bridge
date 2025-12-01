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
 * Parses a WAV file header from a buffer.
 * Returns header info or throws if the format is invalid.
 */
export function parseWavHeader(buffer: ArrayBuffer): WavHeader {
  const view = new DataView(buffer);

  // Check RIFF header
  const riff = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (riff !== 'RIFF') {
    throw new Error('Invalid WAV file: missing RIFF header');
  }

  // Check WAVE format
  const wave = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11)
  );
  if (wave !== 'WAVE') {
    throw new Error('Invalid WAV file: missing WAVE format');
  }

  // Find fmt chunk
  let offset = 12;
  let fmtChunkSize = 0;
  let audioFormat = 0;
  let numChannels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;

  while (offset < buffer.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      fmtChunkSize = chunkSize;
      audioFormat = view.getUint16(offset + 8, true);
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);

      if (audioFormat !== 1 && audioFormat !== 3) {
        throw new Error(`Unsupported audio format: ${audioFormat} (only PCM and IEEE float supported)`);
      }

      offset += 8 + chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  if (fmtChunkSize === 0) {
    throw new Error('Invalid WAV file: missing fmt chunk');
  }

  // Find data chunk
  let dataLength = 0;
  while (offset < buffer.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'data') {
      dataLength = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  return {
    sampleRate,
    numChannels,
    bitsPerSample,
    dataLength,
  };
}

/**
 * Extracts raw audio samples from a WAV file as Float32Array.
 * Automatically handles mono conversion.
 */
export function decodeWav(buffer: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const header = parseWavHeader(buffer);
  const view = new DataView(buffer);

  // Find data chunk offset
  let offset = 12;
  while (offset < buffer.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'data') {
      offset += 8;
      break;
    }

    offset += 8 + chunkSize;
  }

  const bytesPerSample = header.bitsPerSample / 8;
  const numSamples = header.dataLength / bytesPerSample;

  let samples: Float32Array;

  if (header.bitsPerSample === 16) {
    const int16Samples = new Int16Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      int16Samples[i] = view.getInt16(offset + i * 2, true);
    }
    samples = int16ToFloat32(int16Samples);
  } else if (header.bitsPerSample === 32) {
    samples = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      samples[i] = view.getFloat32(offset + i * 4, true);
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
