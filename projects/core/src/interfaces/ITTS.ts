export interface TTSResult {
  readonly audio: Float32Array;
  readonly sampleRate: number;
  readonly duration: number;
}

export interface TTSOptions {
  readonly language: string;
  readonly speaker?: string;
  readonly speed?: number;
}

export interface ITTS {
  initialize(): Promise<void>;
  synthesize(text: string, options: Readonly<TTSOptions>): Promise<TTSResult>;
  getAvailableVoices(): Promise<readonly string[]>;
  dispose(): Promise<void>;
  readonly isReady: boolean;
}
