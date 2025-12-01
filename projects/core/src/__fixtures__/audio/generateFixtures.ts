/**
 * Audio fixture generation utilities.
 * Generates test audio samples for VAD and ASR testing.
 *
 * These generators produce synthetic audio patterns that are designed to
 * trigger VAD models reliably. For ASR testing with real transcription,
 * use actual recorded speech files.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { encodeWav } from "../../audio/AudioConverter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SAMPLE_RATE = 16000;

/**
 * Generates a Float32Array of silence (zeros with minimal noise floor).
 */
export function generateSilence(durationMs: number): Float32Array {
  const numSamples = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const samples = new Float32Array(numSamples);

  // Add very low-level noise floor to simulate real recording conditions
  for (let i = 0; i < numSamples; i++) {
    samples[i] = (Math.random() - 0.5) * 0.001;
  }

  return samples;
}

/**
 * Generates a sine wave tone.
 * Useful for testing audio processing without real speech.
 */
export function generateTone(
  durationMs: number,
  frequencyHz: number,
  amplitude: number = 0.5
): Float32Array {
  const numSamples = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    samples[i] = amplitude * Math.sin(2 * Math.PI * frequencyHz * t);
  }

  return samples;
}

/**
 * Generates a speech-like signal that triggers VAD models.
 *
 * This produces a complex waveform with characteristics that VAD models
 * are trained to recognize as speech:
 * - Fundamental frequency in human voice range (85-255 Hz)
 * - Multiple harmonics (characteristic of voiced speech)
 * - Amplitude modulation (syllabic rhythm)
 * - Formant-like frequency variations
 * - High enough energy to exceed VAD threshold
 */
export function generateSpeechLike(durationMs: number): Float32Array {
  const numSamples = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const samples = new Float32Array(numSamples);

  // Fundamental frequency typical of human speech
  const f0 = 120; // Hz, typical male voice

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;

    // Pitch variation (intonation)
    const pitchMod = 1 + 0.1 * Math.sin(2 * Math.PI * 2 * t);
    const freq = f0 * pitchMod;

    // Generate glottal pulse train with harmonics (voiced speech characteristics)
    let sample = 0;

    // Fundamental and harmonics with decreasing amplitude
    for (let h = 1; h <= 10; h++) {
      const harmonicFreq = freq * h;
      // Spectral tilt: higher harmonics have lower amplitude
      const harmonicAmp = 0.5 / h;
      sample += harmonicAmp * Math.sin(2 * Math.PI * harmonicFreq * t);
    }

    // Amplitude envelope simulating syllabic rhythm (3-5 syllables per second)
    const syllableRate = 4; // Hz
    const envelope =
      0.5 + 0.5 * Math.sin(2 * Math.PI * syllableRate * t - Math.PI / 2);

    // Add slight noise component (aspiration/fricative sounds)
    const noise = (Math.random() - 0.5) * 0.05;

    samples[i] = envelope * (sample * 0.7 + noise);
  }

  // Normalize to reasonable amplitude (avoid stack overflow with large arrays)
  let maxAmp = 0;
  for (let i = 0; i < numSamples; i++) {
    const abs = Math.abs(samples[i] ?? 0);
    if (abs > maxAmp) maxAmp = abs;
  }
  if (maxAmp > 0) {
    for (let i = 0; i < numSamples; i++) {
      samples[i] = ((samples[i] ?? 0) / maxAmp) * 0.8;
    }
  }

  return samples;
}

/**
 * Generates white noise at specified amplitude.
 * Useful for testing VAD rejection of non-speech sounds.
 */
export function generateNoise(
  durationMs: number,
  amplitude: number = 0.3
): Float32Array {
  const numSamples = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    samples[i] = (Math.random() - 0.5) * 2 * amplitude;
  }

  return samples;
}

/**
 * Generates mixed audio with clear speech and silence segments.
 * Returns both the audio and metadata about segment boundaries.
 */
export interface MixedAudioResult {
  readonly samples: Float32Array;
  readonly segments: ReadonlyArray<{
    readonly type: "speech" | "silence";
    readonly startMs: number;
    readonly endMs: number;
  }>;
}

export function generateMixedAudio(): MixedAudioResult {
  const segments: Array<{
    type: "speech" | "silence";
    startMs: number;
    endMs: number;
    samples: Float32Array;
  }> = [];

  // Pattern: 500ms silence, 1000ms speech, 500ms silence, 500ms speech, 500ms silence
  let currentMs = 0;

  const addSegment = (
    type: "speech" | "silence",
    durationMs: number
  ): void => {
    const samples =
      type === "speech"
        ? generateSpeechLike(durationMs)
        : generateSilence(durationMs);

    segments.push({
      type,
      startMs: currentMs,
      endMs: currentMs + durationMs,
      samples,
    });

    currentMs += durationMs;
  };

  addSegment("silence", 500);
  addSegment("speech", 1000);
  addSegment("silence", 500);
  addSegment("speech", 500);
  addSegment("silence", 500);

  // Concatenate all segments
  const totalLength = segments.reduce((sum, s) => sum + s.samples.length, 0);
  const result = new Float32Array(totalLength);

  let offset = 0;
  for (const segment of segments) {
    result.set(segment.samples, offset);
    offset += segment.samples.length;
  }

  return {
    samples: result,
    segments: segments.map((s) => ({
      type: s.type,
      startMs: s.startMs,
      endMs: s.endMs,
    })),
  };
}

/**
 * Generates audio with speech at the end without trailing silence.
 * Critical for testing VAD flush() behavior.
 */
export function generateSpeechWithoutTrailingSilence(
  silenceDurationMs: number,
  speechDurationMs: number
): Float32Array {
  const silence = generateSilence(silenceDurationMs);
  const speech = generateSpeechLike(speechDurationMs);

  const result = new Float32Array(silence.length + speech.length);
  result.set(silence);
  result.set(speech, silence.length);

  return result;
}

/**
 * Generates long audio for testing streaming/chunked processing.
 * Alternates between speech and silence in a predictable pattern.
 */
export function generateLongMixedAudio(
  totalDurationMs: number,
  speechDurationMs: number = 2000,
  silenceDurationMs: number = 500
): MixedAudioResult {
  const segments: Array<{
    type: "speech" | "silence";
    startMs: number;
    endMs: number;
    samples: Float32Array;
  }> = [];

  let currentMs = 0;
  let isSpeech = false;

  while (currentMs < totalDurationMs) {
    const durationMs = isSpeech ? speechDurationMs : silenceDurationMs;
    const remainingMs = totalDurationMs - currentMs;
    const actualDurationMs = Math.min(durationMs, remainingMs);

    const samples = isSpeech
      ? generateSpeechLike(actualDurationMs)
      : generateSilence(actualDurationMs);

    segments.push({
      type: isSpeech ? "speech" : "silence",
      startMs: currentMs,
      endMs: currentMs + actualDurationMs,
      samples,
    });

    currentMs += actualDurationMs;
    isSpeech = !isSpeech;
  }

  const totalLength = segments.reduce((sum, s) => sum + s.samples.length, 0);
  const result = new Float32Array(totalLength);

  let offset = 0;
  for (const segment of segments) {
    result.set(segment.samples, offset);
    offset += segment.samples.length;
  }

  return {
    samples: result,
    segments: segments.map((s) => ({
      type: s.type,
      startMs: s.startMs,
      endMs: s.endMs,
    })),
  };
}

/**
 * Concatenates multiple audio buffers.
 */
export function concatenateAudio(...buffers: Float32Array[]): Float32Array {
  const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
  const result = new Float32Array(totalLength);

  let offset = 0;
  for (const buffer of buffers) {
    result.set(buffer, offset);
    offset += buffer.length;
  }

  return result;
}

/**
 * Saves fixtures as WAV files.
 */
export function saveFixtures(): void {
  const outputDir = __dirname;

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Generate and save silence fixture
  const silence = generateSilence(1000);
  const silenceWav = encodeWav(silence, SAMPLE_RATE);
  writeFileSync(join(outputDir, "silence-1s.wav"), Buffer.from(silenceWav));

  // Generate and save speech-like fixture
  const speech = generateSpeechLike(500);
  const speechWav = encodeWav(speech, SAMPLE_RATE);
  writeFileSync(join(outputDir, "speech-short.wav"), Buffer.from(speechWav));

  // Generate and save mixed audio fixture
  const mixed = generateMixedAudio();
  const mixedWav = encodeWav(mixed.samples, SAMPLE_RATE);
  writeFileSync(
    join(outputDir, "mixed-speech-silence.wav"),
    Buffer.from(mixedWav)
  );

  // Generate speech without trailing silence
  const noTrailingSilence = generateSpeechWithoutTrailingSilence(500, 1000);
  const noTrailingSilenceWav = encodeWav(noTrailingSilence, SAMPLE_RATE);
  writeFileSync(
    join(outputDir, "speech-no-trailing-silence.wav"),
    Buffer.from(noTrailingSilenceWav)
  );
}

// Run fixture generation if executed directly
if (import.meta.url.endsWith(process.argv[1] ?? "")) {
  saveFixtures();
}
