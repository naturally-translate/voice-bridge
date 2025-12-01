export interface VADSegment {
  readonly start: number;
  readonly end: number;
  readonly confidence: number;
}

export interface VADOptions {
  readonly threshold?: number;
  readonly minSilenceDurationMs?: number;
  readonly minSpeechDurationMs?: number;
  readonly speechPadMs?: number;
}

export interface IVAD {
  initialize(): Promise<void>;
  process(audioData: Float32Array): Promise<readonly VADSegment[]>;
  reset(): void;
  dispose(): Promise<void>;
  readonly isReady: boolean;
}
