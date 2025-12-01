export interface ASRWord {
  readonly word: string;
  readonly start: number;
  readonly end: number;
  readonly confidence?: number;
}

export interface ASRResult {
  readonly text: string;
  readonly language: string;
  readonly confidence?: number;
  readonly words?: readonly ASRWord[];
}

export interface ASROptions {
  readonly language?: string;
  readonly timestamps?: boolean;
  readonly task?: 'transcribe' | 'translate';
}

export interface IASR {
  initialize(): Promise<void>;
  transcribe(audioData: Float32Array, options?: Readonly<ASROptions>): Promise<ASRResult>;
  dispose(): Promise<void>;
  readonly isReady: boolean;
}
