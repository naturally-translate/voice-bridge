# VoiceBridge Implementation Plan

**References**: [plans/initial-requirement.md](./initial-requirement.md), [README.md](../README.md)

## Executive Summary

This plan implements VoiceBridge as a real-time translation system following the monorepo architecture with core-first design, GraphQL API shim, and Electron control plane. All features from the requirements will be implemented in a single comprehensive build.

**Key Decisions (Confirmed)**:

- GraphQL API with Apollo Server
- React + Material UI for UI
- JavaScript/WASM (Transformers.js) for ML
- Models downloaded on first run with progressive loading
- File input first, then live microphone
- Target: macOS Apple Silicon, 16GB RAM minimum

## Architecture Overview

Following README.md principles:

```
┌─────────────────────────────────────────────────────────────┐
│ projects/client-app (Electron)                              │
│ ┌─────────────────┐ ┌─────────────────────────────────────┐│
│ │ Main Process    │ │ Renderer Process                    ││
│ │ - Host API      │ │ - Apollo Client                     ││
│ │ - Audio I/O     │ │ - React + MUI UI                    ││
│ │                 │ │ - Control plane (start/stop/config) ││
│ └────────┬────────┘ └─────────────────────────────────────┘│
└──────────┼───────────────────────────────────────────────────┘
           │ GraphQL (queries/mutations/subscriptions)
┌──────────┼───────────────────────────────────────────────────┐
│ projects/api (GraphQL Shim)                                 │
│ - Apollo Server                                             │
│ - Thin resolvers (validation, mapping only)                 │
│ - Subscription plumbing (PubSub)                            │
│ - HTTP streaming endpoints                                  │
└──────────┼───────────────────────────────────────────────────┘
           │ Import Core modules
┌──────────┼───────────────────────────────────────────────────┐
│ projects/core (Framework-agnostic)                          │
│ ┌─────────────────┐ ┌─────────────────┐ ┌────────────────┐│
│ │ Model Wrappers  │ │ Audio Pipeline  │ │ Model Manager  ││
│ │ - ASREngine     │ │ - VAD           │ │ - Download     ││
│ │ - TransEngine   │ │ - Orchestrator  │ │ - Cache        ││
│ │ - TTSEngine     │ │ - Streaming     │ │ - Progressive  ││
│ └─────────────────┘ └─────────────────┘ └────────────────┘│
│ ┌─────────────────────────────────────────────────────────┐│
│ │ Config, Logging, Utilities (framework-agnostic)         ││
│ └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Implementation Strategy

### Phase 1: Foundation & Tooling Setup

**Goal**: Establish TypeScript monorepo with build tooling and basic structure

#### 1.1 Root-Level Configuration

- **TypeScript**: Create root `tsconfig.json` with strict mode, shared compiler options
- **ESLint/Prettier**: Shared code style across packages
- **Build scripts**: pnpm workspace commands for parallel builds
- **Git hooks**: Pre-commit linting with husky

#### 1.2 Package-Level Setup

**projects/core/package.json** dependencies:

```json
{
  "dependencies": {
    "@xenova/transformers": "^2.17.0",
    "onnxruntime-node": "^1.17.0",
    "fluent-ffmpeg": "^2.1.2",
    "@ffmpeg-installer/ffmpeg": "^1.1.0",
    "node-wav": "^0.0.2"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "@types/node": "^20.0.0",
    "vitest": "^1.0.0"
  }
}
```

**projects/api/package.json** dependencies:

```json
{
  "dependencies": {
    "@apollo/server": "^4.10.0",
    "graphql": "^16.8.1",
    "graphql-subscriptions": "^2.0.0",
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "graphql-ws": "^5.14.3",
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "@types/express": "^4.17.21",
    "@types/cors": "^2.8.17",
    "@types/ws": "^8.5.10"
  }
}
```

**projects/client-app/package.json** dependencies:

```json
{
  "dependencies": {
    "electron": "^28.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@mui/material": "^5.15.0",
    "@mui/icons-material": "^5.15.0",
    "@emotion/react": "^11.11.0",
    "@emotion/styled": "^11.11.0",
    "@apollo/client": "^3.9.0",
    "graphql": "^16.8.1"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "electron-builder": "^24.9.0",
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.2.0"
  }
}
```

#### 1.3 Directory Structure

```
projects/
├── core/
│   ├── src/
│   │   ├── index.ts                    # Public API exports
│   │   ├── models/
│   │   │   ├── interfaces.ts           # IASR, ITranslator, ITTS
│   │   │   ├── asr-engine.ts           # ASR wrapper
│   │   │   ├── translation-engine.ts   # Translation wrapper
│   │   │   ├── tts-engine.ts           # TTS wrapper
│   │   │   └── factory.ts              # Model factory pattern
│   │   ├── pipeline/
│   │   │   ├── orchestrator.ts         # Main pipeline coordinator
│   │   │   ├── vad.ts                  # Voice activity detection
│   │   │   ├── audio-processor.ts      # Audio buffer management
│   │   │   └── streaming.ts            # Async iterator utilities
│   │   ├── manager/
│   │   │   ├── model-manager.ts        # Download/cache/load models
│   │   │   ├── cache-manager.ts        # Disk cache operations
│   │   │   └── progressive-loader.ts   # Progressive model loading
│   │   ├── audio/
│   │   │   ├── file-input.ts           # WAV/MP3 file handling
│   │   │   ├── microphone.ts           # Live mic input (future)
│   │   │   └── output.ts               # TTS audio streaming
│   │   ├── config/
│   │   │   ├── models.ts               # Model configuration schema
│   │   │   └── default-config.ts       # Default model configs
│   │   └── utils/
│   │       ├── logger.ts               # Structured logging
│   │       └── workers.ts              # Web Worker utilities
│   ├── tsconfig.json
│   └── package.json
│
├── api/
│   ├── src/
│   │   ├── index.ts                    # Apollo Server setup
│   │   ├── schema/
│   │   │   ├── typeDefs.ts             # GraphQL schema
│   │   │   └── resolvers.ts            # Thin resolvers
│   │   ├── subscriptions/
│   │   │   ├── pubsub.ts               # PubSub instance
│   │   │   └── handlers.ts             # Subscription handlers
│   │   ├── http/
│   │   │   └── streaming.ts            # HTTP audio streaming
│   │   └── context.ts                  # GraphQL context
│   ├── tsconfig.json
│   └── package.json
│
└── client-app/
    ├── src/
    │   ├── main/
    │   │   ├── index.ts                # Electron main process
    │   │   ├── api-host.ts             # Host GraphQL server
    │   │   └── ipc-handlers.ts         # IPC communication
    │   ├── renderer/
    │   │   ├── index.tsx               # React entry point
    │   │   ├── App.tsx                 # Main app component
    │   │   ├── apollo-client.ts        # Apollo Client setup
    │   │   ├── components/
    │   │   │   ├── ControlPanel.tsx    # Start/stop/config
    │   │   │   ├── LanguageSelector.tsx# Multi-lang selection
    │   │   │   ├── TranscriptPanel.tsx # Live transcription
    │   │   │   ├── TranslationPanel.tsx# Translation display
    │   │   │   ├── AudioPlayer.tsx     # TTS audio playback
    │   │   │   ├── FileUpload.tsx      # Audio file input
    │   │   │   └── ModelManager.tsx    # Model download UI
    │   │   ├── hooks/
    │   │   │   ├── useTranscription.ts # GraphQL subscription
    │   │   │   ├── useTranslation.ts   # GraphQL subscription
    │   │   │   └── usePipeline.ts      # Pipeline control
    │   │   └── theme.ts                # MUI theme
    │   ├── tsconfig.json
    │   └── package.json
```

---

## Phase 2: Core Package Implementation

**Goal**: Build framework-agnostic ML pipeline and model management (per README: "Core-first")

### 2.1 Model Interfaces & Abstractions

**File**: `projects/core/src/models/interfaces.ts`

Define interfaces for swappable models:

```typescript
export interface IAudioChunk {
  data: Float32Array;
  sampleRate: number;
  timestamp: number;
}

export interface ITranscriptionResult {
  text: string;
  confidence: number;
  isFinal: boolean;
  timestamp: number;
}

export interface ITranslationResult {
  text: string;
  targetLang: string;
  confidence: number;
}

export interface ITTSChunk {
  audio: ArrayBuffer;
  format: "wav" | "mp3";
  sampleRate: number;
}

export interface IASR {
  initialize(): Promise<void>;
  process(audio: IAudioChunk): AsyncIterableIterator<ITranscriptionResult>;
  dispose(): Promise<void>;
}

export interface ITranslator {
  initialize(): Promise<void>;
  translate(
    text: string,
    targetLang: string
  ): AsyncIterableIterator<ITranslationResult>;
  dispose(): Promise<void>;
}

export interface ITTS {
  initialize(): Promise<void>;
  synthesize(text: string): AsyncIterableIterator<ITTSChunk>;
  dispose(): Promise<void>;
}
```

**Rationale**: Abstract interfaces allow model swapping without changing pipeline code (Requirement #5: Decoupled Architecture)

### 2.2 Model Manager (Download, Cache, Progressive Loading)

**File**: `projects/core/src/manager/model-manager.ts`

Key responsibilities:

- Download models on first run from HuggingFace
- Cache in `~/.voicebridge/models/`
- Progressive loading: start with small models, allow upgrades
- Provide download progress events for UI

```typescript
export interface ModelConfig {
  id: string;
  type: "asr" | "translation" | "tts";
  huggingfaceRepo: string;
  files: string[];
  size: number; // bytes
  priority: "essential" | "recommended" | "optional";
}

export class ModelManager {
  async downloadModel(
    config: ModelConfig,
    onProgress?: (progress: number) => void
  ): Promise<void>;
  async getCachedModels(): Promise<ModelConfig[]>;
  async loadModel(modelId: string): Promise<any>;
  async getDownloadQueue(): Promise<ModelConfig[]>;
}
```

**Progressive Loading Strategy**:

1. **Essential models** (small, fast): Download first
   - ASR: Whisper tiny (39MB) or similar
   - Translation: NLLB-200 distilled 600M (~1.2GB)
   - TTS: Piper lightweight voice
2. **Recommended models**: Download in background
   - ASR: Whisper medium or Parakeet-TDT-20M
   - Translation: NLLB-200 1.3B
3. **Optional models**: User-triggered
   - TTS: XTTS-v2 for voice mimicry

### 2.3 ASR Engine Wrapper

**File**: `projects/core/src/models/asr-engine.ts`

Implement IASR using Transformers.js:

```typescript
import {
  pipeline,
  AutomaticSpeechRecognitionPipeline,
} from "@xenova/transformers";

export class ASREngine implements IASR {
  private model: AutomaticSpeechRecognitionPipeline | null = null;

  async initialize(): Promise<void> {
    // Load model via Transformers.js
    this.model = await pipeline(
      "automatic-speech-recognition",
      "Xenova/whisper-tiny.en"
    );
  }

  async *process(
    audio: IAudioChunk
  ): AsyncIterableIterator<ITranscriptionResult> {
    // Stream transcription word-by-word
    const result = await this.model(audio.data, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });

    yield {
      text: result.text,
      confidence: 0.95,
      isFinal: true,
      timestamp: Date.now(),
    };
  }
}
```

**Note**: Start with Whisper (well-supported in Transformers.js), add Parakeet if ONNX export available

### 2.4 Translation Engine Wrapper

**File**: `projects/core/src/models/translation-engine.ts`

Implement ITranslator with NLLB-200:

```typescript
import { pipeline, TranslationPipeline } from "@xenova/transformers";

export class TranslationEngine implements ITranslator {
  private model: TranslationPipeline | null = null;
  private targetLang: string;

  constructor(targetLang: string) {
    this.targetLang = targetLang; // e.g., 'spa_Latn', 'cmn_Hans'
  }

  async initialize(): Promise<void> {
    this.model = await pipeline(
      "translation",
      "Xenova/nllb-200-distilled-600M",
      {
        src_lang: "eng_Latn",
        tgt_lang: this.targetLang,
      }
    );
  }

  async *translate(
    text: string,
    targetLang: string
  ): AsyncIterableIterator<ITranslationResult> {
    // Stream token-by-token for partial translations
    const output = await this.model(text, {
      tgt_lang: targetLang,
      src_lang: "eng_Latn",
      streamer: true, // Enable streaming
    });

    yield {
      text: output[0].translation_text,
      targetLang,
      confidence: 0.9,
    };
  }
}
```

**Multi-language Strategy**: Spawn separate TranslationEngine instances in Web Workers (Requirement #3)

### 2.5 TTS Engine Wrapper

**File**: `projects/core/src/models/tts-engine.ts`

**Challenge**: No WASM Piper TTS available yet. Options:

1. Use `@diffusionstudio/vits-web` (VITS model in WASM)
2. Use browser SpeechSynthesis API as fallback
3. Wait for Piper WASM port

**Recommended**: Start with browser SpeechSynthesis, plan for VITS upgrade

```typescript
export class TTSEngine implements ITTS {
  private synth: SpeechSynthesis;

  async initialize(): Promise<void> {
    this.synth = window.speechSynthesis;
  }

  async *synthesize(text: string): AsyncIterableIterator<ITTSChunk> {
    const utterance = new SpeechSynthesisUtterance(text);

    // Record audio via MediaRecorder
    const stream = new MediaStream();
    const recorder = new MediaRecorder(stream);

    recorder.ondataavailable = (event) => {
      // Emit chunks as they're generated
    };

    this.synth.speak(utterance);

    // Yield audio chunks
    yield {
      audio: new ArrayBuffer(0), // placeholder
      format: "wav",
      sampleRate: 22050,
    };
  }
}
```

**Future**: Replace with VITS or XTTS WASM port for better quality

### 2.6 Audio Pipeline Orchestrator

**File**: `projects/core/src/pipeline/orchestrator.ts`

Coordinates ASR → Translation(s) → TTS flow with streaming:

```typescript
export interface PipelineConfig {
  targetLanguages: string[]; // ['spa_Latn', 'cmn_Hans', 'kor_Hang']
  enableTTS: boolean;
  vadThreshold: number;
}

export class PipelineOrchestrator {
  private asr: IASR;
  private translators: Map<string, ITranslator>; // lang -> translator
  private tts: ITTS;
  private workers: Worker[] = [];

  constructor(private config: PipelineConfig) {}

  async initialize(): Promise<void> {
    // Load ASR model
    this.asr = new ASREngine();
    await this.asr.initialize();

    // Spawn translator for each target language in separate Workers
    for (const lang of this.config.targetLanguages) {
      const worker = new Worker("./translation-worker.js");
      worker.postMessage({ type: "init", lang });
      this.workers.push(worker);
    }

    // Load TTS
    this.tts = new TTSEngine();
    await this.tts.initialize();
  }

  async *processAudio(
    audioSource: AsyncIterableIterator<IAudioChunk>
  ): AsyncIterableIterator<PipelineOutput> {
    for await (const chunk of audioSource) {
      // 1. ASR: audio -> text
      for await (const transcription of this.asr.process(chunk)) {
        yield { type: "transcription", data: transcription };

        // 2. Translation: text -> translated text (parallel)
        const translationPromises = this.config.targetLanguages.map(
          async (lang) => {
            const translator = this.translators.get(lang)!;
            for await (const translation of translator.translate(
              transcription.text,
              lang
            )) {
              return { type: "translation", lang, data: translation };
            }
          }
        );

        // Emit translations as they arrive
        for (const promise of translationPromises) {
          const result = await promise;
          yield result;

          // 3. TTS: translated text -> audio
          if (this.config.enableTTS && result) {
            for await (const audioChunk of this.tts.synthesize(
              result.data.text
            )) {
              yield { type: "audio", lang: result.lang, data: audioChunk };
            }
          }
        }
      }
    }
  }
}
```

**Key Design**: Uses async iterators throughout for streaming (Requirement #1, #2, #4)

### 2.7 File Input Handler

**File**: `projects/core/src/audio/file-input.ts`

Convert WAV/MP3 to audio chunks:

```typescript
import ffmpeg from "fluent-ffmpeg";

export class FileInputProcessor {
  async *processFile(filePath: string): AsyncIterableIterator<IAudioChunk> {
    // Use FFmpeg to convert to WAV PCM
    const stream = ffmpeg(filePath)
      .toFormat("wav")
      .audioFrequency(16000)
      .audioChannels(1)
      .pipe();

    // Read stream in chunks, yield as IAudioChunk
    for await (const buffer of stream) {
      yield {
        data: new Float32Array(buffer),
        sampleRate: 16000,
        timestamp: Date.now(),
      };
    }
  }
}
```

**Testing Strategy**: Use sample MP3/WAV files to validate pipeline before adding live mic

---

## Phase 3: API Package Implementation

**Goal**: Thin GraphQL shim exposing Core functionality (per README: "API as a shim")

### 3.1 GraphQL Schema

**File**: `projects/api/src/schema/typeDefs.ts`

```graphql
type Query {
  health: String!
  availableModels: [Model!]!
  modelStatus(modelId: ID!): ModelStatus!
}

type Mutation {
  startPipeline(input: PipelineInput!): PipelineSession!
  stopPipeline(sessionId: ID!): Boolean!
  swapModel(component: ModelComponent!, modelId: ID!): Boolean!
  downloadModel(modelId: ID!): DownloadJob!
}

type Subscription {
  transcription(sessionId: ID!): TranscriptionEvent!
  translation(sessionId: ID!, lang: String!): TranslationEvent!
  audioStream(sessionId: ID!, lang: String!): AudioChunk!
  modelDownloadProgress(jobId: ID!): DownloadProgress!
}

input PipelineInput {
  targetLanguages: [String!]!
  enableTTS: Boolean!
  audioSource: AudioSourceInput!
}

input AudioSourceInput {
  type: AudioSourceType!
  filePath: String # for FILE type
}

enum AudioSourceType {
  FILE
  MICROPHONE
}

enum ModelComponent {
  ASR
  TRANSLATION
  TTS
}

type PipelineSession {
  id: ID!
  status: SessionStatus!
  startedAt: String!
}

enum SessionStatus {
  INITIALIZING
  RUNNING
  STOPPED
  ERROR
}

type TranscriptionEvent {
  text: String!
  confidence: Float!
  isFinal: Boolean!
  timestamp: String!
}

type TranslationEvent {
  text: String!
  targetLang: String!
  confidence: Float!
}

type AudioChunk {
  data: String! # Base64-encoded audio
  format: AudioFormat!
  sampleRate: Int!
}

enum AudioFormat {
  WAV
  MP3
}

type Model {
  id: ID!
  name: String!
  type: ModelComponent!
  size: Float!
  isDownloaded: Boolean!
  priority: ModelPriority!
}

enum ModelPriority {
  ESSENTIAL
  RECOMMENDED
  OPTIONAL
}

type ModelStatus {
  id: ID!
  isDownloaded: Boolean!
  isLoaded: Boolean!
  downloadProgress: Float
}

type DownloadJob {
  id: ID!
  modelId: ID!
  status: DownloadStatus!
}

enum DownloadStatus {
  QUEUED
  DOWNLOADING
  COMPLETED
  FAILED
}

type DownloadProgress {
  jobId: ID!
  progress: Float! # 0-100
  bytesDownloaded: Float!
  totalBytes: Float!
  status: DownloadStatus!
}
```

### 3.2 Resolvers (Thin Wrappers)

**File**: `projects/api/src/schema/resolvers.ts`

Delegate to Core modules:

```typescript
import { PipelineOrchestrator } from "@voicebridge/core";
import { PubSub } from "graphql-subscriptions";

const pubsub = new PubSub();
const sessions = new Map<string, PipelineOrchestrator>();

export const resolvers = {
  Query: {
    health: () => "OK",

    availableModels: async () => {
      const modelManager = new ModelManager();
      return await modelManager.getAvailableModels();
    },

    modelStatus: async (_, { modelId }) => {
      const modelManager = new ModelManager();
      return await modelManager.getModelStatus(modelId);
    },
  },

  Mutation: {
    startPipeline: async (_, { input }) => {
      const sessionId = generateId();

      // Create orchestrator (Core)
      const orchestrator = new PipelineOrchestrator({
        targetLanguages: input.targetLanguages,
        enableTTS: input.enableTTS,
        vadThreshold: 0.5,
      });

      await orchestrator.initialize();
      sessions.set(sessionId, orchestrator);

      // Start processing audio (async)
      if (input.audioSource.type === "FILE") {
        const fileProcessor = new FileInputProcessor();
        const audioStream = fileProcessor.processFile(
          input.audioSource.filePath
        );

        // Process pipeline and publish events
        (async () => {
          for await (const event of orchestrator.processAudio(audioStream)) {
            if (event.type === "transcription") {
              pubsub.publish(`TRANSCRIPTION_${sessionId}`, event.data);
            } else if (event.type === "translation") {
              pubsub.publish(
                `TRANSLATION_${sessionId}_${event.lang}`,
                event.data
              );
            } else if (event.type === "audio") {
              pubsub.publish(`AUDIO_${sessionId}_${event.lang}`, event.data);
            }
          }
        })();
      }

      return {
        id: sessionId,
        status: "RUNNING",
        startedAt: new Date().toISOString(),
      };
    },

    downloadModel: async (_, { modelId }) => {
      const modelManager = new ModelManager();
      const jobId = generateId();

      // Start download (async)
      modelManager.downloadModel(modelId, (progress) => {
        pubsub.publish(`DOWNLOAD_PROGRESS_${jobId}`, {
          jobId,
          progress,
          status: "DOWNLOADING",
        });
      });

      return { id: jobId, modelId, status: "DOWNLOADING" };
    },
  },

  Subscription: {
    transcription: {
      subscribe: (_, { sessionId }) =>
        pubsub.asyncIterator(`TRANSCRIPTION_${sessionId}`),
    },

    translation: {
      subscribe: (_, { sessionId, lang }) =>
        pubsub.asyncIterator(`TRANSLATION_${sessionId}_${lang}`),
    },

    audioStream: {
      subscribe: (_, { sessionId, lang }) =>
        pubsub.asyncIterator(`AUDIO_${sessionId}_${lang}`),
    },

    modelDownloadProgress: {
      subscribe: (_, { jobId }) =>
        pubsub.asyncIterator(`DOWNLOAD_PROGRESS_${jobId}`),
    },
  },
};
```

**Rationale**: Resolvers are thin—validation and mapping only. Business logic stays in Core (per README guidelines)

### 3.3 Apollo Server Setup

**File**: `projects/api/src/index.ts`

```typescript
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/lib/use/ws";
import express from "express";
import cors from "cors";
import { typeDefs } from "./schema/typeDefs";
import { resolvers } from "./schema/resolvers";

export async function startAPIServer(port: number = 4000) {
  const app = express();
  const httpServer = createServer(app);

  // WebSocket server for subscriptions
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: "/graphql",
  });

  const schema = makeExecutableSchema({ typeDefs, resolvers });

  const serverCleanup = useServer({ schema }, wsServer);

  const apolloServer = new ApolloServer({
    schema,
    plugins: [
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
            },
          };
        },
      },
    ],
  });

  await apolloServer.start();

  app.use("/graphql", cors(), express.json(), expressMiddleware(apolloServer));

  // HTTP audio streaming endpoint (chunked transfer)
  app.get("/audio-stream/:sessionId/:lang", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "audio/wav",
      "Transfer-Encoding": "chunked",
    });

    // Subscribe to audio chunks from PubSub, pipe to response
    const subscription = pubsub.asyncIterator(
      `AUDIO_${req.params.sessionId}_${req.params.lang}`
    );

    (async () => {
      for await (const chunk of subscription) {
        res.write(Buffer.from(chunk.data, "base64"));
      }
      res.end();
    })();
  });

  httpServer.listen(port, () => {
    console.log(`API server running on http://localhost:${port}/graphql`);
  });

  return { apolloServer, httpServer };
}
```

---

## Phase 4: Client Package Implementation

**Goal**: Electron app with React + MUI control plane (per README: "Client as control plane")

### 4.1 Electron Main Process

**File**: `projects/client-app/src/main/index.ts`

```typescript
import { app, BrowserWindow } from "electron";
import { startAPIServer } from "@voicebridge/api";

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  // Start GraphQL server in main process
  await startAPIServer(4000);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173"); // Vite dev server
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(createWindow);
```

### 4.2 Apollo Client Setup

**File**: `projects/client-app/src/renderer/apollo-client.ts`

```typescript
import { ApolloClient, InMemoryCache, HttpLink, split } from "@apollo/client";
import { GraphQLWsLink } from "@apollo/client/link/subscriptions";
import { getMainDefinition } from "@apollo/client/utilities";
import { createClient } from "graphql-ws";

const httpLink = new HttpLink({
  uri: "http://localhost:4000/graphql",
});

const wsLink = new GraphQLWsLink(
  createClient({
    url: "ws://localhost:4000/graphql",
  })
);

const splitLink = split(
  ({ query }) => {
    const definition = getMainDefinition(query);
    return (
      definition.kind === "OperationDefinition" &&
      definition.operation === "subscription"
    );
  },
  wsLink,
  httpLink
);

export const apolloClient = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
});
```

### 4.3 Main App Component

**File**: `projects/client-app/src/renderer/App.tsx`

```tsx
import React from "react";
import { ApolloProvider } from "@apollo/client";
import { ThemeProvider, CssBaseline, Container, Grid } from "@mui/material";
import { theme } from "./theme";
import { apolloClient } from "./apollo-client";
import ControlPanel from "./components/ControlPanel";
import TranscriptPanel from "./components/TranscriptPanel";
import TranslationPanel from "./components/TranslationPanel";
import ModelManager from "./components/ModelManager";

export default function App() {
  return (
    <ApolloProvider client={apolloClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Container maxWidth="xl" sx={{ py: 4 }}>
          <Grid container spacing={3}>
            {/* Top: Control Panel */}
            <Grid item xs={12}>
              <ControlPanel />
            </Grid>

            {/* Left: Original Transcription */}
            <Grid item xs={12} md={4}>
              <TranscriptPanel />
            </Grid>

            {/* Right: Multi-language Translations */}
            <Grid item xs={12} md={8}>
              <Grid container spacing={2}>
                <Grid item xs={4}>
                  <TranslationPanel lang="spa_Latn" label="Spanish" />
                </Grid>
                <Grid item xs={4}>
                  <TranslationPanel lang="cmn_Hans" label="Chinese" />
                </Grid>
                <Grid item xs={4}>
                  <TranslationPanel lang="kor_Hang" label="Korean" />
                </Grid>
              </Grid>
            </Grid>

            {/* Bottom: Model Manager */}
            <Grid item xs={12}>
              <ModelManager />
            </Grid>
          </Grid>
        </Container>
      </ThemeProvider>
    </ApolloProvider>
  );
}
```

### 4.4 Control Panel Component

**File**: `projects/client-app/src/renderer/components/ControlPanel.tsx`

```tsx
import React, { useState } from "react";
import { useMutation } from "@apollo/client";
import {
  Card,
  CardContent,
  Button,
  TextField,
  FormControlLabel,
  Checkbox,
} from "@mui/material";
import { PlayArrow, Stop } from "@mui/icons-material";
import { START_PIPELINE, STOP_PIPELINE } from "../graphql/mutations";

export default function ControlPanel() {
  const [audioFile, setAudioFile] = useState<string>("");
  const [enableTTS, setEnableTTS] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [startPipeline, { loading: starting }] = useMutation(START_PIPELINE);
  const [stopPipeline, { loading: stopping }] = useMutation(STOP_PIPELINE);

  const handleStart = async () => {
    const result = await startPipeline({
      variables: {
        input: {
          targetLanguages: ["spa_Latn", "cmn_Hans", "kor_Hang"],
          enableTTS,
          audioSource: {
            type: "FILE",
            filePath: audioFile,
          },
        },
      },
    });

    setSessionId(result.data.startPipeline.id);
  };

  const handleStop = async () => {
    if (sessionId) {
      await stopPipeline({ variables: { sessionId } });
      setSessionId(null);
    }
  };

  const handleFileSelect = () => {
    // Electron IPC to open file dialog
    window.electron.selectAudioFile().then(setAudioFile);
  };

  return (
    <Card>
      <CardContent>
        <TextField
          fullWidth
          label="Audio File"
          value={audioFile}
          onClick={handleFileSelect}
          InputProps={{ readOnly: true }}
          sx={{ mb: 2 }}
        />

        <FormControlLabel
          control={
            <Checkbox
              checked={enableTTS}
              onChange={(e) => setEnableTTS(e.target.checked)}
            />
          }
          label="Enable Text-to-Speech"
        />

        <Button
          variant="contained"
          startIcon={sessionId ? <Stop /> : <PlayArrow />}
          onClick={sessionId ? handleStop : handleStart}
          disabled={starting || stopping || (!sessionId && !audioFile)}
          fullWidth
        >
          {sessionId ? "Stop Pipeline" : "Start Pipeline"}
        </Button>
      </CardContent>
    </Card>
  );
}
```

### 4.5 Translation Panel Component

**File**: `projects/client-app/src/renderer/components/TranslationPanel.tsx`

```tsx
import React, { useEffect, useState } from "react";
import { useSubscription } from "@apollo/client";
import { Card, CardHeader, CardContent, Typography, Box } from "@mui/material";
import { TRANSLATION_SUBSCRIPTION } from "../graphql/subscriptions";

interface Props {
  lang: string;
  label: string;
  sessionId?: string;
}

export default function TranslationPanel({ lang, label, sessionId }: Props) {
  const [text, setText] = useState("");

  const { data } = useSubscription(TRANSLATION_SUBSCRIPTION, {
    variables: { sessionId, lang },
    skip: !sessionId,
  });

  useEffect(() => {
    if (data?.translation) {
      // Streaming: append new tokens
      setText((prev) => prev + " " + data.translation.text);
    }
  }, [data]);

  return (
    <Card sx={{ height: 400, display: "flex", flexDirection: "column" }}>
      <CardHeader title={label} />
      <CardContent sx={{ flex: 1, overflow: "auto" }}>
        <Typography variant="body1" component="div">
          {text || <em>Waiting for translation...</em>}
        </Typography>
      </CardContent>
    </Card>
  );
}
```

### 4.6 Model Manager Component

**File**: `projects/client-app/src/renderer/components/ModelManager.tsx`

```tsx
import React from "react";
import { useQuery, useMutation, useSubscription } from "@apollo/client";
import {
  Card,
  CardHeader,
  CardContent,
  List,
  ListItem,
  ListItemText,
  Button,
  LinearProgress,
  Chip,
} from "@mui/material";
import { Download, CheckCircle } from "@mui/icons-material";
import { AVAILABLE_MODELS } from "../graphql/queries";
import { DOWNLOAD_MODEL } from "../graphql/mutations";
import { DOWNLOAD_PROGRESS } from "../graphql/subscriptions";

export default function ModelManager() {
  const { data: modelsData } = useQuery(AVAILABLE_MODELS);
  const [downloadModel] = useMutation(DOWNLOAD_MODEL);
  const [downloadingJobs, setDownloadingJobs] = useState<Set<string>>(
    new Set()
  );

  const handleDownload = async (modelId: string) => {
    const result = await downloadModel({ variables: { modelId } });
    setDownloadingJobs((prev) =>
      new Set(prev).add(result.data.downloadModel.id)
    );
  };

  return (
    <Card>
      <CardHeader title="Model Manager" />
      <CardContent>
        <List>
          {modelsData?.availableModels.map((model) => (
            <ListItem key={model.id}>
              <ListItemText
                primary={model.name}
                secondary={`${model.type} • ${(model.size / 1e9).toFixed(
                  2
                )} GB`}
              />

              <Chip
                label={model.priority}
                size="small"
                color={model.priority === "ESSENTIAL" ? "error" : "default"}
                sx={{ mr: 2 }}
              />

              {model.isDownloaded ? (
                <CheckCircle color="success" />
              ) : (
                <Button
                  startIcon={<Download />}
                  onClick={() => handleDownload(model.id)}
                  size="small"
                >
                  Download
                </Button>
              )}

              {/* Show progress for downloading models */}
              <DownloadProgressIndicator jobId={model.downloadJobId} />
            </ListItem>
          ))}
        </List>
      </CardContent>
    </Card>
  );
}

function DownloadProgressIndicator({ jobId }: { jobId?: string }) {
  const { data } = useSubscription(DOWNLOAD_PROGRESS, {
    variables: { jobId },
    skip: !jobId,
  });

  if (!data?.modelDownloadProgress) return null;

  return (
    <Box sx={{ width: 200, ml: 2 }}>
      <LinearProgress
        variant="determinate"
        value={data.modelDownloadProgress.progress}
      />
    </Box>
  );
}
```

---

## Implementation Order & Critical Path

### Step 1: Foundation (Week 1)

1. ✅ Setup TypeScript configs for all packages
2. ✅ Install dependencies (pnpm install)
3. ✅ Create basic directory structure
4. ✅ Setup ESLint/Prettier
5. ✅ Configure build tooling (tsc for core/api, vite for client)

### Step 2: Core Package - Model Infrastructure (Week 2)

6. ✅ Implement model interfaces (`interfaces.ts`)
7. ✅ Build ModelManager (download, cache, progressive loading)
8. ✅ Create default model configs (`models.json`)
9. ✅ Implement file input handler (`file-input.ts`)
10. ✅ Add logger and utilities

**Milestone**: Can download and cache models

### Step 3: Core Package - Engines (Week 3)

11. ✅ Implement ASREngine with Whisper (Transformers.js)
12. ✅ Implement TranslationEngine with NLLB-200
13. ✅ Implement TTSEngine (browser SpeechSynthesis initially)
14. ✅ Build PipelineOrchestrator with streaming support
15. ✅ Add Web Worker support for multi-language

**Milestone**: Core pipeline works end-to-end with file input

### Step 4: API Package (Week 4)

16. ✅ Define GraphQL schema (`typeDefs.ts`)
17. ✅ Implement resolvers (thin wrappers)
18. ✅ Setup Apollo Server with WebSocket support
19. ✅ Add HTTP streaming endpoint for audio
20. ✅ Test with GraphQL Playground

**Milestone**: API exposes all Core functionality via GraphQL

### Step 5: Client Package - Basic UI (Week 5)

21. ✅ Setup Electron main process
22. ✅ Configure Vite + React + MUI
23. ✅ Setup Apollo Client with subscriptions
24. ✅ Build ControlPanel component
25. ✅ Build FileUpload component
26. ✅ Build basic layout

**Milestone**: Can start/stop pipeline from UI

### Step 6: Client Package - Streaming UI (Week 6)

27. ✅ Build TranscriptPanel with live updates
28. ✅ Build TranslationPanel with streaming text
29. ✅ Build AudioPlayer for TTS output
30. ✅ Add multi-panel layout for 3-4 languages
31. ✅ Implement typing-effect animations

**Milestone**: Full streaming translation UI working

### Step 7: Model Management UI (Week 7)

32. ✅ Build ModelManager component
33. ✅ Add download progress indicators
34. ✅ Implement progressive loading UI
35. ✅ Add model swapping interface
36. ✅ First-run setup wizard

**Milestone**: User can manage models from UI

### Step 8: Audio Enhancements (Week 8)

37. ✅ Upgrade TTS to VITS or better WASM TTS
38. ✅ Add live microphone input
39. ✅ Implement VAD for speech segmentation
40. ✅ Optimize Web Audio API usage
41. ✅ Add audio playback controls

**Milestone**: Production-quality audio I/O

### Step 9: Testing & Polish (Week 9-10)

42. ✅ Unit tests for Core modules (Vitest)
43. ✅ Integration tests for API resolvers
44. ✅ E2E tests for Electron app (Playwright)
45. ✅ Performance optimization (memory profiling)
46. ✅ Error handling and edge cases
47. ✅ UI/UX polish (loading states, errors, etc.)

**Milestone**: Production-ready application

### Step 10: Stretch Goals (Week 11+)

48. ⭐ Implement XTTS-v2 for voice mimicry
49. ⭐ Add Parakeet-TDT-20M ASR support
50. ⭐ Multi-client support via GraphQL
51. ⭐ Advanced model swapping (hot-reload)
52. ⭐ Recording/export functionality

---

## Critical Files Summary

### Core Package

- `src/models/interfaces.ts` - Model abstractions (IASR, ITranslator, ITTS)
- `src/models/asr-engine.ts` - Whisper wrapper
- `src/models/translation-engine.ts` - NLLB-200 wrapper
- `src/models/tts-engine.ts` - TTS wrapper
- `src/pipeline/orchestrator.ts` - Main pipeline coordinator
- `src/manager/model-manager.ts` - Download/cache/load models
- `src/audio/file-input.ts` - WAV/MP3 file handling
- `src/config/models.ts` - Model configuration schema

### API Package

- `src/schema/typeDefs.ts` - GraphQL schema
- `src/schema/resolvers.ts` - Thin resolvers delegating to Core
- `src/index.ts` - Apollo Server + Express setup
- `src/subscriptions/pubsub.ts` - PubSub for real-time events

### Client Package

- `src/main/index.ts` - Electron main process
- `src/renderer/App.tsx` - Main React app
- `src/renderer/apollo-client.ts` - Apollo Client config
- `src/renderer/components/ControlPanel.tsx` - Start/stop/config
- `src/renderer/components/TranslationPanel.tsx` - Live translation display
- `src/renderer/components/ModelManager.tsx` - Model download UI

---

## Key Design Decisions & Rationale

### 1. Core-First Architecture (per README)

- **Decision**: All business logic in `projects/core`
- **Rationale**: Enables reusability, testability, and framework independence. API and Client are thin layers.

### 2. Streaming via Async Iterators

- **Decision**: Use `AsyncIterableIterator<T>` for ASR/Translation/TTS
- **Rationale**: Native JavaScript primitives for streaming, works with GraphQL subscriptions, enables progressive updates (Requirements #1, #2)

### 3. GraphQL Subscriptions for Real-Time

- **Decision**: WebSocket-based GraphQL subscriptions for transcription/translation/audio
- **Rationale**: Unified transport, auto-reconnect, matches user preference for GraphQL

### 4. Progressive Model Loading

- **Decision**: Essential → Recommended → Optional model tiers
- **Rationale**: Fast first-run experience, background downloads for quality upgrades (Requirement #4)

### 5. Web Workers for Multi-Language

- **Decision**: Spawn TranslationEngine per language in separate Workers
- **Rationale**: True parallelism for 3-4 simultaneous translations without blocking (Requirement #3)

### 6. File Input First

- **Decision**: Implement WAV/MP3 before live mic
- **Rationale**: Easier testing, repeatable inputs, matches user preference (Requirement #6)

### 7. Browser SpeechSynthesis Initial TTS

- **Decision**: Use native API initially, plan VITS/XTTS upgrade
- **Rationale**: Fastest path to working TTS, WASM options still maturing

### 8. Electron Main Process Hosts API

- **Decision**: Run Apollo Server in Electron main process
- **Rationale**: Simplifies deployment (single binary), no separate server process needed

---

## Testing Strategy

### Unit Tests (Vitest)

- Core model wrappers (ASREngine, TranslationEngine, TTSEngine)
- ModelManager download/cache logic
- PipelineOrchestrator streaming
- File input processor

### Integration Tests

- GraphQL resolvers with mock Core modules
- End-to-end pipeline with sample audio files
- Subscription delivery (transcription/translation/audio)

### E2E Tests (Playwright)

- Electron app launch
- File upload and pipeline start
- Live transcription/translation updates
- Model download flow

---

## Performance Targets & Constraints

- **Latency**: 2-4s end-to-end (audio → transcription → translation → TTS)
- **RAM**: 4-6GB for 3-4 simultaneous languages
- **Throughput**: Process 30s audio files in <10s
- **Model Load Time**: <30s for essential models on first run
- **Streaming Delay**: <500ms for transcription/translation updates

---

## Risk Mitigation

### Risk: WASM TTS Not Available

- **Mitigation**: Use browser SpeechSynthesis initially, monitor VITS/Piper WASM ports

### Risk: NLLB-200 Too Large for RAM

- **Mitigation**: Start with 600M distilled model, offer 1.3B as optional upgrade

### Risk: Transformers.js Parakeet Support Incomplete

- **Mitigation**: Use Whisper as primary ASR (well-supported), Parakeet as stretch goal

### Risk: Multi-Language RAM Exhaustion

- **Mitigation**: Limit to 3 languages on 16GB, add RAM detection and warnings

### Risk: FFmpeg Bundle Size

- **Mitigation**: Use @ffmpeg-installer/ffmpeg (platform-specific binaries), ~100MB acceptable

---

## Success Metrics

- ✅ All 7 requirements from `plans/initial-requirement.md` implemented
- ✅ Core package is framework-agnostic (testable without Electron)
- ✅ API resolvers are <50 lines each (thin shim)
- ✅ Client UI updates in real-time (<500ms latency)
- ✅ First-run experience: models download in <5 minutes
- ✅ 3 languages translate simultaneously without crashes
- ✅ Code coverage >70% for Core modules

---

## Future Enhancements (Post-MVP)

1. **Voice Mimicry**: XTTS-v2 integration for intonation preservation
2. **Cloud Models**: Optional API fallback for larger models (GPT-4, etc.)
3. **Multi-Client**: Multiple Electron instances sharing one API server
4. **Recording**: Save sessions to disk (audio + transcripts)
5. **Language Detection**: Auto-detect source language
6. **Custom Voices**: Fine-tune TTS on user voice samples
7. **Mobile App**: React Native client consuming same GraphQL API

---

## References

- [plans/initial-requirement.md](../../../plans/initial-requirement.md) - Feature requirements and technical specifications
- [README.md](../../../README.md) - Architecture guidelines and monorepo structure
- Transformers.js: <https://huggingface.co/docs/transformers.js>
- Apollo GraphQL: <https://www.apollographql.com/docs/>
- Electron: <https://www.electronjs.org/docs/latest/>
- Material-UI: <https://mui.com/material-ui/>
