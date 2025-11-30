# Voice Bridge - Implementation Plan

## Executive Summary

**Overall Feasibility: YES - Highly Attainable**

Voice Bridge is a real-time multi-language translation system with **voice intonation matching** as the primary differentiator. The requirements are feasible and well-architected for a 2025 JS/Electron/WASM ML stack.

**Architecture: Client-Server Separation**

The system follows a **client-server model** where:

- **Server** (the workhorse): Handles all heavy ML processing, model management, and translation pipeline execution. Can run locally or on remote machines.
- **Client** (configuration UI): Lightweight Electron app focused on configuration, session management, and monitoring. Multiple clients can connect to a single server.

### Project Scope (Clarified Requirements)

**Core Features:**

1. ✅ Multi-client support via GraphQL API with subscriptions
2. ✅ Three simultaneous languages: Spanish, Chinese, Korean
3. ✅ **Voice intonation matching and mimicry (XTTS-v2) - PRIMARY GOAL**
4. ✅ Streaming for text translation and audio output
5. ✅ On-demand model downloads (not bundled with application)
6. ✅ Multi-format audio input (WAV, MP3 via ffmpeg)
7. ✅ Decoupled architecture with model swapping capability

**Technology Stack (User-Confirmed):**

- **UI Framework**: React + TypeScript + Material UI (MUI)
- **Build Tool**: Vite
- **VAD**: Silero VAD
- **ASR**: Parakeet TDT (via Transformers.js)
- **Translation**: NLLB-200 (via Transformers.js)
- **TTS**: XTTS-v2 with prosody embeddings for intonation matching
- **API**: GraphQL (Apollo Server + Apollo Client)
- **Testing**: Vitest with boundary tests for each module

**Platform Targets:**

- **Primary**: Apple Silicon (16GB RAM) for testing
- **Production**: Cross-platform (macOS, Windows, Linux)

**Model Distribution Strategy:**

- On-demand downloads via Transformers.js auto-download
- Cache location: `models/` directory
- No bundling (keeps app size small, enables offline after first download)

## Current State

The repository is in **early scaffolding stage**:

- ✅ Excellent architectural foundation (pnpm monorepo, oxlint, clear README)
- ✅ Well-thought-out three-layer design (Core → API → Client)
- ❌ No TypeScript configuration
- ❌ No source code implementation
- ❌ No dependencies installed for individual projects
- ❌ No build system configured

## Architecture Overview

### System Architecture Diagram

```mermaid
graph TB
    subgraph "Client Layer (Electron + React)"
        UI[Material UI Interface]
        AC[Apollo Client]
        AudioIn[Web Audio API - Input]
        AudioOut[Audio Player - Output]
    end

    subgraph "API Layer (GraphQL)"
        AS[Apollo Server]
        WS[WebSocket Subscriptions]
        SM[Session Manager]
        PS[PubSub Event Bus]
    end

    subgraph "Core Layer (Business Logic)"
        TP[Translation Pipeline]
        VAD[Silero VAD]
        ASR[Parakeet ASR]

        subgraph "Translation Workers (3x)"
            TW1[NLLB - Spanish]
            TW2[NLLB - Chinese]
            TW3[NLLB - Korean]
        end

        subgraph "TTS Workers (3x)"
            TTW1[XTTS Client - ES]
            TTW2[XTTS Client - ZH]
            TTW3[XTTS Client - KO]
        end

        MM[Model Manager]
        PE[Prosody Extractor]
    end

    subgraph "External Services"
        XTTS[XTTS-v2 Python Server<br/>FastAPI + TTS Library]
        HF[Hugging Face Hub<br/>Model Downloads]
    end

    UI --> AC
    AC <-->|GraphQL/WebSocket| AS
    AS --> WS
    AS --> SM
    AS --> PS

    AudioIn -->|PCM Audio| TP
    TP -->|Translated Audio| AudioOut

    TP --> VAD
    VAD -->|Voice Activity| ASR
    ASR -->|English Text| TW1
    ASR -->|English Text| TW2
    ASR -->|English Text| TW3

    TW1 -->|Spanish Text| TTW1
    TW2 -->|Chinese Text| TTW2
    TW3 -->|Korean Text| TTW3

    AudioIn -->|Reference Audio| PE
    PE -->|Speaker Embedding| TTW1
    PE -->|Speaker Embedding| TTW2
    PE -->|Speaker Embedding| TTW3

    TTW1 -->|Synthesize Request| XTTS
    TTW2 -->|Synthesize Request| XTTS
    TTW3 -->|Synthesize Request| XTTS

    XTTS -->|Audio + Intonation| TTW1
    XTTS -->|Audio + Intonation| TTW2
    XTTS -->|Audio + Intonation| TTW3

    MM -->|Download Models| HF

    style TP fill:#ff9800
    style PE fill:#ff9800
    style XTTS fill:#e91e63
```

### Component Interaction Sequence

```mermaid
sequenceDiagram
    participant U as User (Speaking)
    participant UI as Client UI
    participant API as GraphQL API
    participant VAD as Voice Activity Detection
    participant ASR as Speech Recognition
    participant T as Translation Workers
    participant TTS as TTS Workers
    participant XTTS as XTTS-v2 Server
    participant Audio as Audio Output

    U->>UI: Start speaking
    UI->>API: Subscribe to streamTranscription
    UI->>API: Subscribe to streamTranslation
    UI->>API: Subscribe to streamAudio

    loop Audio Stream
        UI->>VAD: Send audio chunks
        VAD->>VAD: Detect voice activity

        alt Voice detected
            VAD->>ASR: Forward audio
            ASR->>ASR: Transcribe to English text
            ASR->>API: Emit transcription event
            API->>UI: Stream English text

            ASR->>T: Send English text

            par Parallel Translation
                T->>T: Translate to Spanish
                T->>API: Emit Spanish text
                API->>UI: Stream Spanish text
            and
                T->>T: Translate to Chinese
                T->>API: Emit Chinese text
                API->>UI: Stream Chinese text
            and
                T->>T: Translate to Korean
                T->>API: Emit Korean text
                API->>UI: Stream Korean text
            end

            par Parallel TTS Synthesis
                T->>TTS: Spanish text + speaker embedding
                TTS->>XTTS: Synthesize (ES, embedding)
                XTTS->>TTS: Spanish audio with matched intonation
                TTS->>API: Emit audio event
                API->>UI: Stream Spanish audio
                UI->>Audio: Play Spanish audio
            and
                T->>TTS: Chinese text + speaker embedding
                TTS->>XTTS: Synthesize (ZH, embedding)
                XTTS->>TTS: Chinese audio with matched intonation
                TTS->>API: Emit audio event
                API->>UI: Stream Chinese audio
                UI->>Audio: Play Chinese audio
            and
                T->>TTS: Korean text + speaker embedding
                TTS->>XTTS: Synthesize (KO, embedding)
                XTTS->>TTS: Korean audio with matched intonation
                TTS->>API: Emit audio event
                API->>UI: Stream Korean audio
                UI->>Audio: Play Korean audio
            end
        end
    end

    U->>UI: Stop speaking
    UI->>API: Stop pipeline
```

### Data Flow: Voice Input to Translated Output

```mermaid
flowchart TD
    Start([User Speaks into Microphone]) --> Capture[Capture Audio via Web Audio API]
    Capture --> Buffer[Audio Buffer<br/>16kHz PCM]

    Buffer --> VAD{Silero VAD<br/>Voice Detected?}
    VAD -->|No - Silence| Buffer
    VAD -->|Yes - Voice Activity| ASR[Parakeet TDT ASR<br/>Speech-to-Text]

    ASR --> EnglishText[English Transcription]
    EnglishText --> Display1[Display English Text in UI]

    EnglishText --> Fork{Broadcast to<br/>3 Translation Workers}

    Fork -->|Worker 1| NLLB_ES[NLLB Translation<br/>English → Spanish]
    Fork -->|Worker 2| NLLB_ZH[NLLB Translation<br/>English → Chinese]
    Fork -->|Worker 3| NLLB_KO[NLLB Translation<br/>English → Korean]

    NLLB_ES --> SpanishText[Spanish Text]
    NLLB_ZH --> ChineseText[Chinese Text]
    NLLB_KO --> KoreanText[Korean Text]

    SpanishText --> Display2[Display Spanish Text]
    ChineseText --> Display3[Display Chinese Text]
    KoreanText --> Display4[Display Korean Text]

    Buffer --> ProsodyExtract[Extract Speaker Embedding<br/>First 3-6 seconds]
    ProsodyExtract --> Embedding[(Speaker Embedding<br/>Voice Signature)]

    SpanishText --> TTS_ES[XTTS TTS Worker<br/>Spanish Synthesis]
    ChineseText --> TTS_ZH[XTTS TTS Worker<br/>Chinese Synthesis]
    KoreanText --> TTS_KO[XTTS TTS Worker<br/>Korean Synthesis]

    Embedding -.->|Apply Intonation| TTS_ES
    Embedding -.->|Apply Intonation| TTS_ZH
    Embedding -.->|Apply Intonation| TTS_KO

    TTS_ES --> XTTS_Server_ES[XTTS-v2 Python Server<br/>Synthesize with Prosody]
    TTS_ZH --> XTTS_Server_ZH[XTTS-v2 Python Server<br/>Synthesize with Prosody]
    TTS_KO --> XTTS_Server_KO[XTTS-v2 Python Server<br/>Synthesize with Prosody]

    XTTS_Server_ES --> AudioES[Spanish Audio<br/>with User's Voice]
    XTTS_Server_ZH --> AudioZH[Chinese Audio<br/>with User's Voice]
    XTTS_Server_KO --> AudioKO[Korean Audio<br/>with User's Voice]

    AudioES --> PlayES[Play Spanish Audio]
    AudioZH --> PlayZH[Play Chinese Audio]
    AudioKO --> PlayKO[Play Korean Audio]

    PlayES --> End([User Hears Translations])
    PlayZH --> End
    PlayKO --> End

    style Start fill:#4caf50
    style End fill:#4caf50
    style Embedding fill:#ff9800
    style ProsodyExtract fill:#ff9800
    style XTTS_Server_ES fill:#e91e63
    style XTTS_Server_ZH fill:#e91e63
    style XTTS_Server_KO fill:#e91e63
```

### Pipeline State Machine

```mermaid
stateDiagram-v2
    [*] --> Idle

    Idle --> Initializing: User clicks "Start"
    Initializing --> LoadingModels: Check model availability
    LoadingModels --> DownloadingModels: Models missing
    LoadingModels --> Ready: Models cached

    DownloadingModels --> DownloadingModels: Progress updates
    DownloadingModels --> Ready: All models loaded
    DownloadingModels --> Error: Download failed

    Ready --> ExtractingProsody: Audio detected
    ExtractingProsody --> Listening: Embedding extracted
    ExtractingProsody --> Error: Extraction failed

    Listening --> Processing: Voice activity detected
    Listening --> Listening: Silence detected

    Processing --> Transcribing: Audio chunk ready
    Transcribing --> Translating: Text recognized
    Translating --> Synthesizing: Translations complete
    Synthesizing --> Listening: Audio output sent

    Listening --> Paused: User pauses
    Processing --> Paused: User pauses
    Paused --> Listening: User resumes

    Listening --> Stopping: User stops
    Processing --> Stopping: User stops
    Stopping --> Idle: Cleanup complete

    Error --> Idle: User resets
```

### Translation Pipeline Activity Diagram

```mermaid
graph LR
    subgraph "Input Processing"
        A[Microphone Input] --> B[Audio Chunk<br/>20ms frames]
        B --> C{VAD Check}
        C -->|Silence| B
        C -->|Voice| D[Accumulate Audio]
    end

    subgraph "Speech Recognition"
        D --> E[ASR Processing]
        E --> F{Utterance<br/>Complete?}
        F -->|No| E
        F -->|Yes| G[English Text]
    end

    subgraph "Parallel Translation Pipeline"
        G --> H1[Translation<br/>Worker 1]
        G --> H2[Translation<br/>Worker 2]
        G --> H3[Translation<br/>Worker 3]

        H1 --> I1[Spanish Text]
        H2 --> I2[Chinese Text]
        H3 --> I3[Korean Text]
    end

    subgraph "Parallel TTS Pipeline"
        I1 --> J1[TTS Worker 1]
        I2 --> J2[TTS Worker 2]
        I3 --> J3[TTS Worker 3]

        SE[Speaker<br/>Embedding] -.-> J1
        SE -.-> J2
        SE -.-> J3

        J1 --> K1[Spanish Audio]
        J2 --> K2[Chinese Audio]
        J3 --> K3[Korean Audio]
    end

    subgraph "Output"
        K1 --> L[Audio Mixer]
        K2 --> L
        K3 --> L
        L --> M[Speakers/Headphones]
    end

    A -.->|First 3-6s| PE[Prosody<br/>Extraction]
    PE --> SE

    style SE fill:#ff9800
    style PE fill:#ff9800
```

### Web Worker Architecture

```mermaid
graph TB
    subgraph "Main Thread"
        UI[UI Components]
        Pipeline[Translation Pipeline Orchestrator]
        AudioContext[Web Audio API Context]
    end

    subgraph "Audio Worklet Thread"
        VAD_Worklet[VAD Audio Worklet<br/>Real-time Processing]
    end

    subgraph "Translation Worker Pool"
        TW1[Worker 1<br/>NLLB Spanish<br/>~1.2GB RAM]
        TW2[Worker 2<br/>NLLB Chinese<br/>~1.2GB RAM]
        TW3[Worker 3<br/>NLLB Korean<br/>~1.2GB RAM]
    end

    subgraph "TTS Worker Pool"
        TTW1[Worker 1<br/>XTTS Client ES<br/>HTTP Calls]
        TTW2[Worker 2<br/>XTTS Client ZH<br/>HTTP Calls]
        TTW3[Worker 3<br/>XTTS Client KO<br/>HTTP Calls]
    end

    subgraph "ASR Worker"
        ASR_Worker[Parakeet TDT Worker<br/>~1.2GB RAM]
    end

    subgraph "External Process"
        Python[XTTS-v2 Python Server<br/>~2GB RAM<br/>Port 8000]
    end

    AudioContext -->|Audio Chunks| VAD_Worklet
    VAD_Worklet -->|Voice Activity| Pipeline
    Pipeline -->|Audio| ASR_Worker
    ASR_Worker -->|English Text| Pipeline

    Pipeline -->|Text| TW1
    Pipeline -->|Text| TW2
    Pipeline -->|Text| TW3

    TW1 -->|Translated Text| Pipeline
    TW2 -->|Translated Text| Pipeline
    TW3 -->|Translated Text| Pipeline

    Pipeline -->|Text + Embedding| TTW1
    Pipeline -->|Text + Embedding| TTW2
    Pipeline -->|Text + Embedding| TTW3

    TTW1 -->|HTTP POST| Python
    TTW2 -->|HTTP POST| Python
    TTW3 -->|HTTP POST| Python

    Python -->|Audio Data| TTW1
    Python -->|Audio Data| TTW2
    Python -->|Audio Data| TTW3

    TTW1 -->|Audio| Pipeline
    TTW2 -->|Audio| Pipeline
    TTW3 -->|Audio| Pipeline

    Pipeline --> UI
    Pipeline --> AudioContext

    style Python fill:#e91e63
    style VAD_Worklet fill:#2196f3
```

### Memory Allocation Diagram

```mermaid
pie title Memory Budget (16GB Apple Silicon)
    "OS + System" : 3000
    "Electron + Browser" : 2000
    "Parakeet ASR" : 1200
    "NLLB Spanish" : 1200
    "NLLB Chinese" : 1200
    "NLLB Korean" : 1200
    "XTTS Python Server" : 2000
    "Working Memory + Buffers" : 3000
    "Silero VAD" : 10
    "Available Headroom" : 2190
```

### GraphQL Subscription Flow

```mermaid
sequenceDiagram
    participant Client as Client UI
    participant Server as GraphQL Server
    participant PubSub as PubSub Event Bus
    participant Pipeline as Translation Pipeline

    Client->>Server: WebSocket Connect
    Server->>Client: Connection Established

    Client->>Server: subscription { streamTranscription }
    Client->>Server: subscription { streamTranslation(lang: "es") }
    Client->>Server: subscription { streamTranslation(lang: "zh") }
    Client->>Server: subscription { streamTranslation(lang: "ko") }
    Client->>Server: subscription { streamAudio(lang: "es") }
    Client->>Server: subscription { streamAudio(lang: "zh") }
    Client->>Server: subscription { streamAudio(lang: "ko") }

    Server->>Client: Subscriptions Active

    loop Real-time Processing
        Pipeline->>PubSub: Publish transcription event
        PubSub->>Server: Event received
        Server->>Client: { data: { text: "Hello" } }

        Pipeline->>PubSub: Publish translation event (es)
        PubSub->>Server: Event received
        Server->>Client: { data: { text: "Hola", lang: "es" } }

        Pipeline->>PubSub: Publish translation event (zh)
        PubSub->>Server: Event received
        Server->>Client: { data: { text: "你好", lang: "zh" } }

        Pipeline->>PubSub: Publish translation event (ko)
        PubSub->>Server: Event received
        Server->>Client: { data: { text: "안녕하세요", lang: "ko" } }

        Pipeline->>PubSub: Publish audio event (es)
        PubSub->>Server: Event received
        Server->>Client: { data: { audio: ArrayBuffer, lang: "es" } }

        Pipeline->>PubSub: Publish audio event (zh)
        PubSub->>Server: Event received
        Server->>Client: { data: { audio: ArrayBuffer, lang: "zh" } }

        Pipeline->>PubSub: Publish audio event (ko)
        PubSub->>Server: Event received
        Server->>Client: { data: { audio: ArrayBuffer, lang: "ko" } }
    end

    Client->>Server: mutation { stopPipeline }
    Server->>Pipeline: Stop command
    Pipeline->>Server: Stopped
    Server->>Client: { success: true }
```

### Voice Intonation Matching Process (Primary Differentiator)

```mermaid
sequenceDiagram
    autonumber
    participant User as User Speaking
    participant Mic as Microphone
    participant Buffer as Audio Buffer
    participant PE as Prosody Extractor
    participant XTTS as XTTS-v2 Server
    participant Store as Embedding Store
    participant Trans as Translation Pipeline
    participant TTS as TTS Workers (3x)
    participant Output as Audio Output

    Note over User,Output: PHASE 1: Initial Speaker Embedding Extraction

    User->>Mic: Start speaking (first 3-6 seconds)
    Mic->>Buffer: Capture reference audio
    Buffer->>PE: Send reference audio chunk
    PE->>XTTS: POST /extract-embedding<br/>{audio: base64}

    Note over XTTS: Analyze speaker characteristics:<br/>- Pitch patterns<br/>- Speech rhythm<br/>- Voice timbre<br/>- Emotional tone

    XTTS->>XTTS: Extract prosody features
    XTTS->>PE: Return speaker_embedding<br/>(768-dim vector)
    PE->>Store: Cache embedding

    Note over Store: Embedding contains:<br/>- Voice signature<br/>- Intonation patterns<br/>- Speaking style

    Note over User,Output: PHASE 2: Real-time Translation with Intonation

    User->>Mic: Continue speaking
    Mic->>Trans: Audio stream
    Trans->>Trans: VAD → ASR → Translation

    par Spanish Synthesis
        Trans->>TTS: Spanish text
        Store->>TTS: speaker_embedding
        TTS->>XTTS: POST /synthesize<br/>{text: "Hola", lang: "es",<br/>speaker_embedding: vector}

        Note over XTTS: Apply user's voice characteristics<br/>to Spanish output

        XTTS->>TTS: Spanish audio with<br/>user's intonation
        TTS->>Output: Play Spanish
    and Chinese Synthesis
        Trans->>TTS: Chinese text
        Store->>TTS: speaker_embedding
        TTS->>XTTS: POST /synthesize<br/>{text: "你好", lang: "zh",<br/>speaker_embedding: vector}

        Note over XTTS: Apply user's voice characteristics<br/>to Chinese output

        XTTS->>TTS: Chinese audio with<br/>user's intonation
        TTS->>Output: Play Chinese
    and Korean Synthesis
        Trans->>TTS: Korean text
        Store->>TTS: speaker_embedding
        TTS->>XTTS: POST /synthesize<br/>{text: "안녕하세요", lang: "ko",<br/>speaker_embedding: vector}

        Note over XTTS: Apply user's voice characteristics<br/>to Korean output

        XTTS->>TTS: Korean audio with<br/>user's intonation
        TTS->>Output: Play Korean
    end

    Note over User,Output: Result: All 3 languages sound like the user's voice!
```

### XTTS-v2 Python Service Architecture

```mermaid
graph TB
    subgraph "TypeScript/Electron Application"
        TTSWorker1[TTS Worker 1<br/>Spanish]
        TTSWorker2[TTS Worker 2<br/>Chinese]
        TTSWorker3[TTS Worker 3<br/>Korean]
        ProsodyExt[Prosody Extractor]
    end

    subgraph "XTTS-v2 Python Microservice (FastAPI)"
        API[FastAPI Server<br/>Port 8000]

        subgraph "Endpoints"
            Health[GET /health]
            Extract[POST /extract-embedding]
            Synth[POST /synthesize]
        end

        subgraph "XTTS-v2 Engine"
            Model[XTTS-v2 Model<br/>~2GB RAM]
            Speaker[Speaker Encoder]
            Vocoder[Neural Vocoder]
        end

        Cache[(Embedding Cache<br/>In-Memory)]
    end

    ProsodyExt -->|HTTP POST| Extract
    Extract --> Speaker
    Speaker -->|768-dim vector| Cache
    Cache -->|Return| Extract
    Extract -->|JSON Response| ProsodyExt

    TTSWorker1 -->|HTTP POST<br/>Text + Embedding| Synth
    TTSWorker2 -->|HTTP POST<br/>Text + Embedding| Synth
    TTSWorker3 -->|HTTP POST<br/>Text + Embedding| Synth

    Synth --> Model
    Cache -.->|Retrieve| Model
    Model --> Vocoder
    Vocoder -->|WAV Audio| Synth
    Synth -->|Base64 Audio| TTSWorker1
    Synth -->|Base64 Audio| TTSWorker2
    Synth -->|Base64 Audio| TTSWorker3

    Health -->|Status Check| API

    style Model fill:#e91e63
    style Speaker fill:#ff9800
    style Cache fill:#ff9800
```

### Complete End-to-End Data Transformation

```mermaid
graph TD
    subgraph "Stage 1: Audio Capture"
        A1[Raw Microphone Input<br/>48kHz, Stereo, Float32]
        A2[Resampled Audio<br/>16kHz, Mono, Int16]
        A3[Audio Chunks<br/>20ms frames]
    end

    subgraph "Stage 2: Voice Detection"
        B1[VAD Processing<br/>Silero VAD Model]
        B2{Voice Activity?}
        B3[Silence Buffer]
        B4[Voice Buffer]
    end

    subgraph "Stage 3: Speech Recognition"
        C1[Accumulated Audio<br/>Until pause detected]
        C2[Parakeet TDT Model<br/>ASR Processing]
        C3[English Text<br/>'Hello, how are you?']
    end

    subgraph "Stage 4: Parallel Translation"
        D1[NLLB-200 Model ES<br/>English → Spanish]
        D2[NLLB-200 Model ZH<br/>English → Chinese]
        D3[NLLB-200 Model KO<br/>English → Korean]
        D4[Spanish Text<br/>'Hola, ¿cómo estás?']
        D5[Chinese Text<br/>'你好，你好吗？']
        D6[Korean Text<br/>'안녕하세요, 어떻게 지내세요?']
    end

    subgraph "Stage 5: Prosody Extraction"
        E1[Reference Audio<br/>First 3-6 seconds]
        E2[XTTS Speaker Encoder]
        E3[Speaker Embedding<br/>768-dim vector<br/>Unique voice signature]
    end

    subgraph "Stage 6: Voice Synthesis"
        F1[XTTS-v2 Synthesis ES<br/>Text + Embedding]
        F2[XTTS-v2 Synthesis ZH<br/>Text + Embedding]
        F3[XTTS-v2 Synthesis KO<br/>Text + Embedding]
        F4[Spanish Audio<br/>WAV, user's voice]
        F5[Chinese Audio<br/>WAV, user's voice]
        F6[Korean Audio<br/>WAV, user's voice]
    end

    subgraph "Stage 7: Audio Output"
        G1[Audio Decoding]
        G2[Volume Normalization]
        G3[Speaker Output<br/>3 channels mixed]
    end

    A1 --> A2 --> A3
    A3 --> B1
    B1 --> B2
    B2 -->|Silence| B3 --> A3
    B2 -->|Voice| B4
    B4 --> C1
    C1 --> C2
    C2 --> C3

    C3 --> D1 --> D4
    C3 --> D2 --> D5
    C3 --> D3 --> D6

    A2 --> E1
    E1 --> E2
    E2 --> E3

    D4 --> F1
    D5 --> F2
    D6 --> F3
    E3 -.->|Apply| F1
    E3 -.->|Apply| F2
    E3 -.->|Apply| F3

    F1 --> F4
    F2 --> F5
    F3 --> F6

    F4 --> G1
    F5 --> G1
    F6 --> G1
    G1 --> G2
    G2 --> G3

    style E3 fill:#ff9800
    style E2 fill:#ff9800
    style F1 fill:#e91e63
    style F2 fill:#e91e63
    style F3 fill:#e91e63
```

### Three-Layer Design (Revised: Client-Server Separation)

**projects/server** (Translation Server - The Workhorse)

Combines Core + API into a standalone server process that can run independently:

- ASR, Translation, TTS, VAD service implementations
- TranslationPipeline orchestration
- Web Worker architecture for parallelism
- Model management (on-demand downloads)
- Audio processing utilities
- GraphQL API with WebSocket subscriptions
- Session management for multi-client support
- Can run locally or on remote machine
- Accepts audio input (live stream or file upload)
- Produces audio output (live stream or file download)

**projects/client-app** (Configuration & Control UI)

Lightweight Electron + React application focused on configuration:

- **Model Configuration UI**: Select ASR, Translation, TTS models
- **Session Configuration UI**:
  - Input settings (live audio via audio jack OR file upload MP3/WAV)
  - Language settings (enable/disable Spanish, Chinese, Korean)
  - Output settings (live stream OR save to file)
- **Server Connection**: Connect to local or remote server
- **Session Control**: Start/stop translation sessions
- **Real-time Monitoring**: Display transcription, translations, and status
- Apollo Client for GraphQL communication
- No heavy ML processing (all done server-side)

### Deployment Architecture (Revised: Client-Server Model)

```mermaid
graph TB
    subgraph "Client Machine"
        subgraph "Electron Client App"
            UI[Configuration UI<br/>React + MUI]
            Apollo_Client[Apollo GraphQL Client]
            FileUpload[File Upload Handler]
            AudioCapture[Audio Capture<br/>Microphone Input]
            AudioPlayer[Audio Player<br/>Stream Output]
        end

        ClientConfig[Client Config<br/>Server URL<br/>Session Preferences]
    end

    subgraph "Server Machine (Local or Remote)"
        subgraph "Translation Server Process"
            GQL_Server[GraphQL Server<br/>Apollo + WebSocket]
            SessionMgr[Session Manager<br/>Multi-client Support]

            subgraph "Translation Pipeline"
                Pipeline[Pipeline Orchestrator]
                VAD[VAD Audio Worklet]

                subgraph "Web Workers"
                    ASR_Worker[ASR Worker<br/>Parakeet TDT<br/>1.2GB]
                    TW1[Translation Worker 1<br/>NLLB Spanish<br/>1.2GB]
                    TW2[Translation Worker 2<br/>NLLB Chinese<br/>1.2GB]
                    TW3[Translation Worker 3<br/>NLLB Korean<br/>1.2GB]
                    TTW1[TTS Worker 1<br/>XTTS Client]
                    TTW2[TTS Worker 2<br/>XTTS Client]
                    TTW3[TTS Worker 3<br/>XTTS Client]
                end
            end

            ModelMgr[Model Manager]
            AudioIO[Audio I/O Handler<br/>Stream/File]
        end

        subgraph "XTTS Python Service"
            XTTS_API[FastAPI Server<br/>Port 8000]
            XTTS_Model[XTTS-v2 Engine<br/>2GB]
        end

        subgraph "Server Storage"
            Models[ML Models Cache<br/>~8GB]
            Sessions[Session Files<br/>Audio Input/Output]
            ServerConfig[Server Config<br/>Model Selections]
        end
    end

    subgraph "External Services"
        HF[Hugging Face Hub<br/>Model Downloads]
    end

    UI --> Apollo_Client
    Apollo_Client <-->|GraphQL/WebSocket<br/>Can be over network| GQL_Server

    FileUpload -.->|Upload MP3/WAV| AudioIO
    AudioCapture -.->|Stream PCM Audio| AudioIO
    AudioIO -.->|Stream Output| AudioPlayer
    AudioIO -.->|Download File| FileUpload

    GQL_Server --> SessionMgr
    SessionMgr --> Pipeline

    Pipeline --> VAD
    Pipeline --> ASR_Worker
    Pipeline --> TW1
    Pipeline --> TW2
    Pipeline --> TW3
    Pipeline --> TTW1
    Pipeline --> TTW2
    Pipeline --> TTW3

    TTW1 <-->|HTTP| XTTS_API
    TTW2 <-->|HTTP| XTTS_API
    TTW3 <-->|HTTP| XTTS_API

    XTTS_API --> XTTS_Model

    ModelMgr <--> Models
    ModelMgr <-->|Download| HF

    AudioIO <--> Sessions
    Pipeline <--> Models
    XTTS_Model <--> Models

    UI --> ClientConfig
    GQL_Server --> ServerConfig

    style GQL_Server fill:#4caf50
    style XTTS_API fill:#e91e63
    style Models fill:#2196f3
    style UI fill:#ff9800
```

**Deployment Scenarios:**

1. **Local Deployment** (Development/Single User):

   - Client and Server both run on same machine (localhost)
   - Low latency, full resource access

2. **Remote Deployment** (Production/Multi-User):

   - Server runs on powerful machine/cloud instance (16GB+ RAM)
   - Multiple thin clients connect remotely
   - Clients only need network connection, no heavy GPU/RAM

3. **Hybrid Deployment**:
   - Server on local network (e.g., Mac Studio with 64GB RAM)
   - Multiple users connect via LAN
   - Low latency + resource sharing

````

### UI Component Hierarchy (Revised: Configuration-Focused Client)

```mermaid
graph TB
    subgraph "Client Application UI"
        App[App.tsx<br/>Apollo Provider + Theme + Router]

        App --> Layout[MainLayout.tsx<br/>MUI Container]

        Layout --> Header[Header.tsx<br/>App Title + Server Connection]
        Layout --> Main[MainContent.tsx<br/>Tabbed Layout]

        Main --> ConfigTab[Configuration Tab]
        Main --> SessionTab[Session Tab]
        Main --> MonitorTab[Monitor Tab]

        subgraph "Configuration Tab Components"
            ConfigTab --> ServerConfig[ServerConnectionConfig.tsx<br/>Server URL, Connection Status]
            ConfigTab --> ModelConfig[ModelSelectionConfig.tsx<br/>ASR/Translation/TTS Model Picker]
            ConfigTab --> SaveConfig[SaveConfigButton.tsx<br/>Persist to Server]
        end

        subgraph "Session Tab Components"
            SessionTab --> SessionForm[SessionConfigForm.tsx]

            SessionForm --> InputConfig[InputSourceConfig.tsx]
            SessionForm --> LangConfig[LanguageConfig.tsx]
            SessionForm --> OutputConfig[OutputDestinationConfig.tsx]
            SessionForm --> StartSession[StartSessionButton.tsx]

            InputConfig --> LiveAudioInput[LiveAudioInput.tsx<br/>Mic Selection]
            InputConfig --> FileInput[FileInput.tsx<br/>Upload MP3/WAV]

            LangConfig --> SourceLang[SourceLanguage.tsx<br/>Default: English]
            LangConfig --> TargetLangs[TargetLanguages.tsx<br/>Enable ES/ZH/KO]

            OutputConfig --> LiveStream[LiveStreamOutput.tsx<br/>Play in Browser]
            OutputConfig --> FileOutput[FileOutput.tsx<br/>Save to File]
        end

        subgraph "Monitor Tab Components"
            MonitorTab --> SessionList[ActiveSessionsList.tsx<br/>Running Sessions]
            MonitorTab --> Display[TranslationDisplay.tsx<br/>Real-time Results]

            Display --> SourcePanel[SourceTranscription.tsx<br/>English Text Display]
            Display --> TargetPanels[TargetLanguagePanels.tsx<br/>3-Column Layout]

            TargetPanels --> SpanishPanel[SpanishPanel.tsx<br/>Text + Audio Waveform]
            TargetPanels --> ChinesePanel[ChinesePanel.tsx<br/>Text + Audio Waveform]
            TargetPanels --> KoreanPanel[KoreanPanel.tsx<br/>Text + Audio Waveform]

            Display --> AudioPlayer[AudioPlayer.tsx<br/>Playback Controls]
        end

        Layout --> Footer[Footer.tsx<br/>Status Bar]

        Footer --> ConnStatus[ConnectionStatus.tsx<br/>Server Online/Offline]
        Footer --> SessionStatus[SessionStatus.tsx<br/>Active/Idle]
        Footer --> ServerStats[ServerStats.tsx<br/>Server RAM/CPU]
    end

    subgraph "GraphQL Operations"
        Queries[Queries:<br/>- serverInfo<br/>- availableModels<br/>- sessionStatus]
        Mutations[Mutations:<br/>- updateServerConfig<br/>- createSession<br/>- stopSession<br/>- uploadAudioFile]
        Subscriptions[Subscriptions:<br/>- streamTranscription<br/>- streamTranslation<br/>- streamAudio<br/>- sessionStatus]
    end

    ServerConfig -.->|Query| Queries
    ModelConfig -.->|Query| Queries
    ModelConfig -.->|Mutate| Mutations

    SessionForm -.->|Mutate| Mutations
    FileInput -.->|Upload| Mutations

    Display -.->|Subscribe| Subscriptions
    SessionStatus -.->|Subscribe| Subscriptions
    ServerStats -.->|Subscribe| Subscriptions

    style ConfigTab fill:#ff9800
    style SessionTab fill:#2196f3
    style MonitorTab fill:#4caf50
````

### Session Configuration Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as Client UI
    participant Server as Translation Server

    Note over User,Server: Step 1: Configure Server & Models

    User->>UI: Open Configuration Tab
    UI->>Server: Query availableModels()
    Server->>UI: Return model list
    User->>UI: Select ASR, Translation, TTS models
    User->>UI: Click "Save Configuration"
    UI->>Server: Mutation updateServerConfig(models)
    Server->>UI: Configuration saved ✓

    Note over User,Server: Step 2: Configure Session

    User->>UI: Open Session Tab
    User->>UI: Select Input Source

    alt Live Audio Input
        User->>UI: Select microphone device
        UI->>UI: Enable audio capture
    else File Input
        User->>UI: Upload MP3/WAV file
        UI->>Server: Mutation uploadAudioFile(file)
        Server->>UI: File uploaded, ID returned
    end

    User->>UI: Enable target languages (ES, ZH, KO)

    User->>UI: Select Output Destination
    alt Live Stream
        UI->>UI: Prepare audio player
    else Save to File
        UI->>UI: Prepare download handler
    end

    Note over User,Server: Step 3: Start Translation Session

    User->>UI: Click "Start Session"
    UI->>Server: Mutation createSession({<br/>  input: {type, source},<br/>  languages: ["es", "zh", "ko"],<br/>  output: {type, destination}<br/>})
    Server->>Server: Initialize pipeline
    Server->>UI: Session created, ID returned

    UI->>Server: Subscribe to streamTranscription(sessionId)
    UI->>Server: Subscribe to streamTranslation(sessionId, lang)
    UI->>Server: Subscribe to streamAudio(sessionId, lang)

    Note over User,Server: Step 4: Monitor Results

    User->>UI: Switch to Monitor Tab

    loop Real-time Translation
        Server->>UI: Stream transcription updates
        Server->>UI: Stream translation updates
        Server->>UI: Stream audio data
        UI->>User: Display text & play audio
    end

    Note over User,Server: Step 5: Stop Session

    User->>UI: Click "Stop Session"
    UI->>Server: Mutation stopSession(sessionId)
    Server->>Server: Cleanup pipeline

    alt Output to File
        Server->>UI: Download link ready
        UI->>User: Prompt file download
    end

    Server->>UI: Session stopped ✓
```

### Audio Streaming Architecture

```mermaid
graph TB
    subgraph "Client Machine"
        ClientMic[Client Microphone]
        FileSelect[File Selector]

        subgraph "Client App"
            AudioCapture[Web Audio API<br/>Capture]
            FileReader[File Reader]
            GraphQLClient[GraphQL Client<br/>Apollo]
            WSClient[WebSocket Client<br/>Binary Stream]
        end
    end

    subgraph "Server Machine"
        ServerMic[Server Audio Jack]

        subgraph "Server Endpoints"
            GraphQLServer[GraphQL Server<br/>Port 4000]
            WSServer[WebSocket Audio Server<br/>Port 4001]
            FileStorage[File Storage<br/>uploads/]
        end

        subgraph "Processing Pipeline"
            AudioRouter[Audio Router]
            Pipeline[Translation Pipeline]
        end
    end

    %% Scenario 1: Server Audio Device
    ServerMic -->|Direct Access| AudioRouter
    GraphQLClient -->|Mutation createSession<br/>type: SERVER_AUDIO_DEVICE| GraphQLServer
    GraphQLServer -->|Configure| AudioRouter

    %% Scenario 2: File Upload
    FileSelect --> FileReader
    FileReader -->|Multipart Upload| GraphQLClient
    GraphQLClient -->|Mutation uploadAudioFile| GraphQLServer
    GraphQLServer --> FileStorage
    FileStorage -->|Read File| AudioRouter

    %% Scenario 3: Client Stream
    ClientMic --> AudioCapture
    AudioCapture -->|PCM Chunks<br/>ArrayBuffer| WSClient
    WSClient <-->|Binary WebSocket<br/>Port 4001| WSServer
    WSServer -->|Stream Audio| AudioRouter

    GraphQLClient -->|Mutation createSession<br/>type: CLIENT_STREAM<br/>streamConnectionId| GraphQLServer
    GraphQLServer -->|Associate Session| WSServer

    AudioRouter --> Pipeline

    style ServerMic fill:#4caf50
    style FileStorage fill:#2196f3
    style WSServer fill:#ff9800
```

### Audio Source Handling Details

#### **1. Server Audio Device (Lowest Latency)**

```typescript
// Client UI Configuration
const sessionInput = {
  inputSource: {
    type: 'SERVER_AUDIO_DEVICE',
    deviceId: 'default' // or specific device ID from server
  },
  languages: { source: 'EN', targets: ['ES', 'ZH', 'KO'] },
  outputDestination: { type: 'LIVE_STREAM' }
};

// Client sends GraphQL mutation
mutation CreateSession($input: SessionInput!) {
  createSession(input: $input) { id status }
}

// Server directly accesses audio device
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
// No network transmission - server processes locally
```

#### **2. File Upload (GraphQL Multipart Request)**

```typescript
// Client: Select file and upload
const file = document.getElementById("audioFile").files[0];

// Upload via GraphQL multipart request
const { data } = await apolloClient.mutate({
  mutation: UPLOAD_AUDIO_FILE,
  variables: { file },
  context: {
    fetchOptions: {
      useUpload: true, // graphql-upload
    },
  },
});

const fileId = data.uploadAudioFile.id;

// Create session referencing uploaded file
const sessionInput = {
  inputSource: {
    type: "FILE",
    fileId: fileId,
  },
  languages: { source: "EN", targets: ["ES", "ZH", "KO"] },
  outputDestination: { type: "FILE", format: "MP3" },
};
```

**Server Implementation:**

```typescript
// Apollo Server with graphql-upload
import { GraphQLUpload } from "graphql-upload";

const resolvers = {
  Upload: GraphQLUpload,

  Mutation: {
    uploadAudioFile: async (_, { file }) => {
      const { createReadStream, filename, mimetype } = await file;
      const stream = createReadStream();

      // Save to disk
      const filePath = path.join("uploads", `${uuid()}-${filename}`);
      await pipeline(stream, fs.createWriteStream(filePath));

      // Analyze file (duration, format)
      const metadata = await analyzeAudio(filePath);

      return {
        id: uuid(),
        fileName: filename,
        size: metadata.size,
        duration: metadata.duration,
        format: metadata.format,
      };
    },
  },
};
```

#### **3. Client Stream (WebRTC DataChannel - Lowest Latency)**

**Client Implementation:**

```typescript
// Step 1: Create WebRTC peer connection
const pc = new RTCPeerConnection({
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
});

const streamConnectionId = uuid();

// Step 2: Create data channel for audio streaming
const audioChannel = pc.createDataChannel("audio-stream", {
  ordered: false, // Allow out-of-order delivery for lower latency
  maxRetransmits: 0, // Don't retransmit lost packets (real-time priority)
});

// Step 3: Capture and send audio
const audioContext = new AudioContext({ sampleRate: 16000 });
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const source = audioContext.createMediaStreamSource(stream);

// Use AudioWorklet for better performance (replaces ScriptProcessor)
await audioContext.audioWorklet.addModule("/audio-processor.js");
const workletNode = new AudioWorkletNode(
  audioContext,
  "audio-stream-processor"
);

workletNode.port.onmessage = (event) => {
  const { audioData } = event.data;

  // Send PCM audio via WebRTC DataChannel (binary)
  if (audioChannel.readyState === "open") {
    audioChannel.send(audioData.buffer);
  }
};

source.connect(workletNode);
workletNode.connect(audioContext.destination);

// Step 4: WebRTC signaling via GraphQL
audioChannel.onopen = () => {
  console.log("Audio channel opened");
};

// Create offer
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);

// Wait for ICE gathering
await new Promise((resolve) => {
  if (pc.iceGatheringState === "complete") {
    resolve();
  } else {
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") resolve();
    });
  }
});

// Send offer to server via GraphQL
const { data } = await apolloClient.mutate({
  mutation: INITIATE_WEBRTC_SESSION,
  variables: {
    streamConnectionId,
    offer: pc.localDescription,
  },
});

// Receive answer from server
const answer = new RTCSessionDescription(data.initiateWebRTCSession.answer);
await pc.setRemoteDescription(answer);

// Step 5: Create session via GraphQL
const sessionInput = {
  inputSource: {
    type: "CLIENT_STREAM",
    streamConnectionId: streamConnectionId,
  },
  languages: { source: "EN", targets: ["ES", "ZH", "KO"] },
  outputDestination: { type: "LIVE_STREAM" },
};

await apolloClient.mutate({
  mutation: CREATE_SESSION,
  variables: { input: sessionInput },
});
```

**AudioWorklet Processor (audio-processor.js):**

```javascript
// Runs in audio worklet thread for low-latency processing
class AudioStreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];

    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.bufferIndex++] = channelData[i];

      if (this.bufferIndex >= this.bufferSize) {
        // Convert Float32 to Int16 PCM
        const int16Array = new Int16Array(this.bufferSize);
        for (let j = 0; j < this.bufferSize; j++) {
          const s = Math.max(-1, Math.min(1, this.buffer[j]));
          int16Array[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Send to main thread
        this.port.postMessage({ audioData: int16Array });

        // Reset buffer
        this.bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor("audio-stream-processor", AudioStreamProcessor);
```

**Server Implementation:**

```typescript
import { RTCPeerConnection, RTCSessionDescription } from "wrtc"; // Node.js WebRTC

const activeConnections = new Map(); // streamConnectionId -> peer connection

// GraphQL resolver for WebRTC signaling
const resolvers = {
  Mutation: {
    initiateWebRTCSession: async (_, { streamConnectionId, offer }) => {
      // Create peer connection on server
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      // Handle incoming data channel
      pc.ondatachannel = (event) => {
        const dataChannel = event.channel;

        dataChannel.onopen = () => {
          console.log(`Audio channel opened for ${streamConnectionId}`);
        };

        dataChannel.onmessage = (event) => {
          // Receive binary PCM audio data
          const audioData = new Int16Array(event.data);

          // Route to translation pipeline
          emitAudioChunk(streamConnectionId, audioData);
        };

        dataChannel.onerror = (error) => {
          console.error("DataChannel error:", error);
        };
      };

      // Set remote description (client's offer)
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Create answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Store connection
      activeConnections.set(streamConnectionId, pc);

      return {
        streamConnectionId,
        answer: pc.localDescription,
      };
    },

    stopWebRTCSession: async (_, { streamConnectionId }) => {
      const pc = activeConnections.get(streamConnectionId);
      if (pc) {
        pc.close();
        activeConnections.delete(streamConnectionId);
      }
      return true;
    },
  },
};
```

**GraphQL Schema Addition:**

```graphql
type Mutation {
  # ... existing mutations ...

  # WebRTC signaling
  initiateWebRTCSession(
    streamConnectionId: ID!
    offer: RTCSessionDescriptionInput!
  ): WebRTCSessionResponse!

  stopWebRTCSession(streamConnectionId: ID!): Boolean!
}

input RTCSessionDescriptionInput {
  type: String! # "offer" or "answer"
  sdp: String! # Session Description Protocol
}

type WebRTCSessionResponse {
  streamConnectionId: ID!
  answer: RTCSessionDescription!
}

type RTCSessionDescription {
  type: String!
  sdp: String!
}
```

#### **4. File Path (Server-Accessible - Ideal for Testing)**

```typescript
// Client UI Configuration
const sessionInput = {
  inputSource: {
    type: "FILE_PATH",
    filePath: "/Users/tangent/test-audio/sample.wav",
    // Or network path: '/mnt/shared/audio/sample.mp3'
  },
  languages: { source: "EN", targets: ["ES", "ZH", "KO"] },
  outputDestination: { type: "FILE", format: "MP3" },
};

// Client sends GraphQL mutation
await apolloClient.mutate({
  mutation: CREATE_SESSION,
  variables: { input: sessionInput },
});
```

**Server Implementation:**

```typescript
const resolvers = {
  Mutation: {
    createSession: async (_, { input }) => {
      if (input.inputSource.type === "FILE_PATH") {
        const { filePath } = input.inputSource;

        // Validate file exists and is accessible
        if (!fs.existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`);
        }

        // Security check: prevent path traversal attacks
        const resolvedPath = path.resolve(filePath);
        const allowedPaths = [
          "/Users/tangent/test-audio",
          "/mnt/shared/audio",
          process.env.AUDIO_FILES_DIR,
        ].filter(Boolean);

        const isAllowed = allowedPaths.some((allowed) =>
          resolvedPath.startsWith(path.resolve(allowed))
        );

        if (!isAllowed) {
          throw new Error("File path not in allowed directories");
        }

        // Read file directly (no upload needed)
        const audioStream = fs.createReadStream(resolvedPath);

        // Route to translation pipeline
        return await processAudioFile(audioStream, input);
      }
    },
  },
};
```

**Use Cases:**

- **Local Development**: Client and server on same machine, point to local files
- **Shared Filesystem**: Server mounted to NFS/SMB, client references network paths
- **Testing**: Quick iteration without upload overhead
- **Batch Processing**: Process multiple files from a watched directory

**Benefits:**

- No file upload latency
- No duplicate storage (file exists only once)
- Simpler client code (just pass path string)
- Efficient for large files

**Security Considerations:**

- Whitelist allowed directories to prevent arbitrary file access
- Validate paths to prevent directory traversal (`../../etc/passwd`)
- Consider file permissions (server process must have read access)

````

### Protocol Comparison

| Aspect | Server Device | File Upload | File Path | Client Stream |
|--------|--------------|-------------|-----------|---------------|
| **Latency** | Lowest (~10ms) | N/A (batch) | N/A (batch) | Medium (~50-100ms) |
| **Network Usage** | None | One-time upload | None | Continuous (~64kbps) |
| **Use Case** | Server has mic | Remote file processing | Local/shared filesystem | Remote real-time |
| **GraphQL Role** | Session config only | Upload + session config | Session config only | Signaling + session config |
| **Transport** | Local device access | HTTP Multipart | Local filesystem | WebRTC DataChannel |
| **Complexity** | Low | Low | Low | Medium-High |
| **Best For** | Local setup | Remote clients | Testing/development | Production real-time |

### GraphQL Schema (Revised for Client-Server Model)

```graphql
# ============================================
# Server Configuration
# ============================================

type ServerInfo {
  version: String!
  status: ServerStatus!
  capabilities: ServerCapabilities!
  resources: ResourceUsage!
}

type ServerStatus {
  online: Boolean!
  modelsLoaded: Boolean!
  activeSessionsCount: Int!
}

type ServerCapabilities {
  supportedLanguages: [Language!]!
  availableModels: ModelCatalog!
  maxConcurrentSessions: Int!
}

type ModelCatalog {
  asr: [ModelInfo!]!
  translation: [ModelInfo!]!
  tts: [ModelInfo!]!
  vad: [ModelInfo!]!
}

type ModelInfo {
  id: ID!
  name: String!
  size: String!
  downloaded: Boolean!
  loaded: Boolean!
}

type ResourceUsage {
  memoryUsed: Float!
  memoryTotal: Float!
  cpuPercent: Float!
}

enum Language {
  EN
  ES
  ZH
  KO
}

# ============================================
# Session Configuration
# ============================================

input SessionInput {
  inputSource: InputSourceConfig!
  languages: LanguageConfig!
  outputDestination: OutputDestinationConfig!
}

input InputSourceConfig {
  type: InputType!
  fileId: ID                    # For FILE_UPLOAD type
  deviceId: String              # For SERVER_AUDIO_DEVICE type
  streamConnectionId: String    # For CLIENT_STREAM type
  filePath: String              # For FILE_PATH type (server-accessible path)
}

enum InputType {
  SERVER_AUDIO_DEVICE  # Audio jack directly on server
  FILE_UPLOAD          # Client uploads MP3/WAV via GraphQL multipart
  FILE_PATH            # Server reads from accessible file path (local/network)
  CLIENT_STREAM        # Real-time audio from client's microphone
}

input LanguageConfig {
  source: Language!
  targets: [Language!]!
}

input OutputDestinationConfig {
  type: OutputType!
  format: AudioFormat
}

enum OutputType {
  LIVE_STREAM
  FILE
}

enum AudioFormat {
  WAV
  MP3
  FLAC
}

# ============================================
# Session Management
# ============================================

type Session {
  id: ID!
  status: SessionStatus!
  config: SessionConfig!
  createdAt: String!
  startedAt: String
  completedAt: String
  outputFileUrl: String
}

type SessionConfig {
  inputSource: InputSourceInfo!
  languages: LanguageConfig!
  outputDestination: OutputDestinationInfo!
}

type InputSourceInfo {
  type: InputType!
  fileName: String
  duration: Float
}

type OutputDestinationInfo {
  type: OutputType!
  format: AudioFormat
}

enum SessionStatus {
  CREATED
  INITIALIZING
  EXTRACTING_PROSODY
  RUNNING
  PAUSED
  COMPLETING
  COMPLETED
  ERROR
}

# ============================================
# Real-time Streaming Data
# ============================================

type TranscriptionUpdate {
  sessionId: ID!
  timestamp: Float!
  text: String!
  isFinal: Boolean!
}

type TranslationUpdate {
  sessionId: ID!
  language: Language!
  timestamp: Float!
  text: String!
}

type AudioChunk {
  sessionId: ID!
  language: Language!
  timestamp: Float!
  audio: String!      # Base64 encoded audio data
  format: AudioFormat!
}

type SessionStatusUpdate {
  sessionId: ID!
  status: SessionStatus!
  progress: Float
  message: String
}

# ============================================
# Queries
# ============================================

type Query {
  # Server information
  serverInfo: ServerInfo!

  # Model management
  availableModels: ModelCatalog!
  modelInfo(id: ID!): ModelInfo

  # Session queries
  session(id: ID!): Session
  activeSessions: [Session!]!
  sessionHistory(limit: Int = 10): [Session!]!
}

# ============================================
# Mutations
# ============================================

type Mutation {
  # Server configuration
  updateServerConfig(models: ModelSelectionInput!): ServerInfo!
  downloadModel(modelId: ID!): ModelDownloadJob!

  # File upload
  uploadAudioFile(file: Upload!): AudioFile!

  # Session management
  createSession(input: SessionInput!): Session!
  startSession(id: ID!): Session!
  pauseSession(id: ID!): Session!
  resumeSession(id: ID!): Session!
  stopSession(id: ID!): Session!
  deleteSession(id: ID!): Boolean!
}

input ModelSelectionInput {
  asr: ID
  translation: ID
  tts: ID
  vad: ID
}

type ModelDownloadJob {
  modelId: ID!
  progress: Float!
  status: DownloadStatus!
}

enum DownloadStatus {
  QUEUED
  DOWNLOADING
  COMPLETED
  FAILED
}

type AudioFile {
  id: ID!
  fileName: String!
  size: Int!
  duration: Float!
  format: AudioFormat!
}

scalar Upload

# ============================================
# Subscriptions
# ============================================

type Subscription {
  # Real-time translation streaming
  streamTranscription(sessionId: ID!): TranscriptionUpdate!
  streamTranslation(sessionId: ID!, language: Language!): TranslationUpdate!
  streamAudio(sessionId: ID!, language: Language!): AudioChunk!

  # Session status updates
  sessionStatus(sessionId: ID!): SessionStatusUpdate!

  # Server monitoring
  serverStats: ResourceUsage!

  # Model download progress
  modelDownloadProgress(modelId: ID!): ModelDownloadJob!
}
````

### Model Loading & Caching Flow

```mermaid
flowchart TD
    Start([User Launches App]) --> Check{Check Model Cache}

    Check -->|Models Cached| Load[Load from Disk]
    Check -->|Models Missing| Download[Download from HF]

    Download --> Progress[Show Download Progress<br/>ModelStatusPanel]

    subgraph "Downloaded Models"
        M1[Silero VAD<br/>~2MB]
        M2[Parakeet TDT ASR<br/>~1.2GB]
        M3[NLLB Spanish<br/>~600MB]
        M4[NLLB Chinese<br/>~600MB]
        M5[NLLB Korean<br/>~600MB]
        M6[XTTS-v2<br/>~1.8GB]
    end

    Progress --> M1
    Progress --> M2
    Progress --> M3
    Progress --> M4
    Progress --> M5
    Progress --> M6

    M1 --> Cache1[Cache to models/vad/]
    M2 --> Cache2[Cache to models/asr/]
    M3 --> Cache3[Cache to models/nllb/es/]
    M4 --> Cache4[Cache to models/nllb/zh/]
    M5 --> Cache5[Cache to models/nllb/ko/]
    M6 --> Cache6[Cache to models/xtts/]

    Cache1 --> Init
    Cache2 --> Init
    Cache3 --> Init
    Cache4 --> Init
    Cache5 --> Init
    Cache6 --> Init

    Load --> Init[Initialize Workers<br/>Load Models into Memory]

    Init --> Workers{Spawn Workers}

    Workers --> W1[VAD Worklet<br/>10MB RAM]
    Workers --> W2[ASR Worker<br/>1.2GB RAM]
    Workers --> W3[Translation Workers<br/>3x 1.2GB = 3.6GB]
    Workers --> W4[TTS Workers<br/>Lightweight HTTP clients]
    Workers --> W5[XTTS Python Server<br/>2GB RAM]

    W1 --> Ready
    W2 --> Ready
    W3 --> Ready
    W4 --> Ready
    W5 --> Ready[System Ready]

    Ready --> Monitor[Memory Monitoring<br/>~14GB / 16GB Used]

    style Ready fill:#4caf50
    style Monitor fill:#ff9800
```

### Error Handling & Recovery Flow

```mermaid
stateDiagram-v2
    [*] --> Running: Pipeline Started

    Running --> VADError: VAD Failure
    Running --> ASRError: ASR Failure
    Running --> TranslationError: Translation Failure
    Running --> TTSError: TTS/XTTS Failure
    Running --> NetworkError: Network/Download Failure
    Running --> MemoryError: Out of Memory

    VADError --> RetryVAD: Retry with fallback
    RetryVAD --> Running: Success
    RetryVAD --> Degraded: Fallback mode

    ASRError --> RetryASR: Reload ASR model
    RetryASR --> Running: Success
    RetryASR --> Degraded: Partial functionality

    TranslationError --> RetryTranslation: Retry single worker
    RetryTranslation --> Running: Success
    RetryTranslation --> Degraded: 2/3 languages work

    TTSError --> RetryTTS: Restart XTTS server
    RetryTTS --> Running: Success
    RetryTTS --> Degraded: Text-only mode

    NetworkError --> RetryNetwork: Check connectivity
    RetryNetwork --> Running: Success
    RetryNetwork --> Offline: Use cached models

    MemoryError --> Unload: Unload inactive workers
    Unload --> Running: Memory freed
    Unload --> Critical: Cannot free memory

    Degraded --> UserNotification: Show warning
    UserNotification --> Running: User acknowledges

    Offline --> UserNotification
    Critical --> FatalError: Must restart
    FatalError --> [*]

    note right of Degraded
        System continues with reduced
        functionality while showing
        clear user feedback
    end note

    note right of Critical
        Unrecoverable state,
        requires app restart
    end note
```

### Key Technical Decisions

1. **Client-Server Architecture**: Server handles all ML processing, client focuses on configuration and monitoring. Enables remote deployment and multi-client scenarios.
2. **Session-Based Processing**: Each translation task is a configurable session with input source (live/file), target languages, and output destination (stream/file).
3. **XTTS-v2 as Python Microservice**: No mature TypeScript implementation exists; Python backend with HTTP API required for prosody extraction.
4. **NLLB-200 Distilled (600M)**: Fits 3 instances in memory (~3.6GB total).
5. **Web Workers for Parallelism**: 3 translation workers + 3 TTS workers for simultaneous language processing (server-side).
6. **GraphQL Subscriptions**: Standard protocol for multi-client real-time streaming over network.
7. **On-Demand Model Downloads**: Transformers.js auto-download, cached in server's `models/` directory.
8. **Flexible I/O**: Support both live audio streaming and file-based processing for maximum versatility.

### Benefits of Client-Server Architecture

**Scalability:**

- Single powerful server (64GB RAM) can serve multiple lightweight clients
- Easy horizontal scaling by adding more server instances
- Clients require minimal resources (no GPU, minimal RAM)

**Flexibility:**

- Server can run locally (localhost) for development/personal use
- Server can run on remote machine/cloud for production
- Server can run on LAN for team collaboration
- Mix and match: different users can use different input/output modes simultaneously

**Separation of Concerns:**

- **Client**: Configuration UI, session management, monitoring

  - Easy to update UI without touching ML code
  - Can build web client, mobile client, CLI client
  - Minimal dependencies (React, Apollo Client)

- **Server**: ML processing, model management, pipeline orchestration
  - Focus on performance and accuracy
  - Independent testing and optimization
  - Can upgrade models without client changes

**Development Workflow:**

- Frontend developers work on client without needing ML expertise
- ML engineers work on server without touching UI code
- Independent deployment and versioning
- Easier testing (mock server for client tests, mock client for server tests)

**Use Cases Enabled:**

1. **Personal Use**: Client + Server on laptop (localhost)
2. **Team Use**: Server on Mac Studio, multiple team members connect via LAN
3. **Cloud Deployment**: Server on AWS/GCP, clients anywhere with internet
4. **Batch Processing**: Upload files via client, server processes overnight, download results
5. **Multi-Session**: One user runs live translation while another processes files

## Implementation Roadmap

### Phase 1: Foundation & Core Abstractions (Week 1)

**Environment Setup with ASDF**

- Install ASDF version manager: <https://asdf-vm.com/guide/getting-started.html>
- Create `.tool-versions` file in repository root:

  ```text
  nodejs 20.11.1
  python 3.11.8
  poetry 1.8.2
  pnpm 10.7.0
  ```

- Install ASDF plugins:

  ```bash
  asdf plugin add nodejs https://github.com/asdf-vm/asdf-nodejs.git
  asdf plugin add python https://github.com/asdf-community/asdf-python.git
  asdf plugin add poetry https://github.com/asdf-community/asdf-poetry.git
  asdf plugin add pnpm https://github.com/jonathanmorley/asdf-pnpm.git
  ```

- Bootstrap environment: `asdf install` (reads `.tool-versions` and installs all runtimes)
- Verify installations:

  ```bash
  node --version    # 20.11.1
  python --version  # 3.11.8
  poetry --version  # 1.8.2
  pnpm --version    # 10.7.0
  ```

**Setup TypeScript & Dependencies**

- Create `tsconfig.base.json` and per-package configs (strict mode enabled)
- Update `package.json` files with dependencies
- Run `pnpm install` across monorepo

**Core Interfaces** (`projects/core/src/interfaces/`)

- `IASR.ts` - ASR abstraction with streaming support
- `ITranslator.ts` - Translation abstraction for NLLB-200
- `ITTS.ts` - TTS abstraction with speaker embedding support (critical for XTTS-v2)
- `IVAD.ts` - Voice activity detection interface
- `IModelManager.ts` - Model download and caching interface

**ModelManager Implementation**

- `ModelRegistry.ts` - Metadata for Parakeet TDT, NLLB-200, XTTS-v2, Silero VAD
- `ModelManager.ts` - On-demand download via Transformers.js, cache management
- Test with small model (Silero VAD ~2MB)

**Deliverables**: Compilable Core package, working model download system, first boundary tests

### Phase 2: ASR + VAD (Week 2)

**Voice Activity Detection**

- Implement `SileroVAD.ts` using `@ricky0123/vad-web`
- AudioWorklet integration for browser context
- Test with audio fixtures (silence vs speech)

**Speech Recognition**

- Implement `ParakeetASR.ts` using Transformers.js
- Streaming transcription with partial/final results
- Handle 16kHz audio resampling

**Audio Utilities** (`projects/core/src/audio/`)

- `AudioBuffer.ts` - Circular buffer for streaming
- `AudioConverter.ts` - WAV/MP3 format conversion
- `AudioResampler.ts` - Resample to 16kHz for ASR

**Deliverables**: Working VAD and ASR with boundary tests, audio processing pipeline

### Phase 3: Translation with Web Workers (Week 3)

**NLLB Translator**

- Implement `NLLBTranslator.ts` for English → Spanish/Chinese/Korean
- Single-shot translation first, then streaming

**Web Worker Architecture**

- `translation.worker.ts` - Isolated NLLB instance per language
- `worker-pool.ts` - Manage 3 parallel workers with task queuing
- Use Comlink for simplified message passing

**Memory Profiling**

- Load 3 NLLB instances simultaneously
- Verify memory usage <4GB for translations

**Deliverables**: Parallel translation for 3 languages, memory benchmarks

### Phase 4: XTTS-v2 Intonation Matching (Week 4) **[PRIMARY DIFFERENTIATOR]**

**Python Backend Setup**

- Create `xtts-server/` with FastAPI service
- Endpoints: `/extract-embedding`, `/synthesize`, `/health`
- Use TTS library for XTTS-v2 prosody extraction

**TypeScript Client**

- Implement `XTTSSTTS.ts` - HTTP client to Python backend
- `ProsodyExtractor.ts` - Helper for speaker embedding management
- Extract embedding from first 3-6 seconds of reference audio

**Intonation Matching Flow**

1. User speaks (English audio captured)
2. Extract speaker embedding from reference audio
3. Store embedding in pipeline context
4. Pass embedding to all TTS synthesis calls
5. Verify prosody preservation across Spanish/Chinese/Korean output

**TTS Worker Pool**

- `tts.worker.ts` - Calls XTTS API
- 3 workers for parallel synthesis

**Deliverables**: Working intonation matching, demo showing voice preservation

### Phase 5: Pipeline Orchestration (Week 5)

**TranslationPipeline**

- Orchestrate VAD → ASR → Translation (3 langs) → TTS (3 langs)
- Manage worker lifecycle and error handling
- Async generator architecture for streaming

**PipelineContext**

- Shared state: speaker embedding, session config, active languages
- Event bus for status updates

**End-to-End Testing**

- Full pipeline test with real audio
- Measure latency (target: <4s end-to-end)
- Profile memory usage (target: <6GB total)

**Deliverables**: Working pipeline, performance benchmarks

### Phase 6: GraphQL API (Week 6)

**Schema Definition** (`projects/api/src/schema/schema.graphql`)

- Queries: `health`, `modelStatus`, `listModels`, `sessionInfo`
- Mutations: `startPipeline`, `stopPipeline`, `downloadModel`, `updateSpeakerEmbedding`
- Subscriptions: `streamTranscription`, `streamTranslation`, `streamAudio`, `pipelineStatus`

**Apollo Server Setup**

- Configure Express + WebSocket server with `graphql-ws`
- Implement resolvers (thin wrappers around Core services)
- Setup PubSub for subscription events

**Session Management**

- `SessionManager.ts` - Track client sessions, cleanup on disconnect
- Support multiple concurrent clients

**Deliverables**: Running GraphQL server, working subscriptions, integration tests

### Phase 7: Electron Client (Week 7-8)

**Electron Setup**

- Vite configuration for Electron build
- Main process, preload script, renderer setup

**React + MUI Components**

- `TranscriptionView` - Live English transcription display
- `TranslationView` - 3-panel layout for Spanish/Chinese/Korean
- `AudioControls` - Start/stop, volume, language selection
- `ModelStatus` - Download progress indicators

**Apollo Client Integration**

- GraphQL subscriptions for real-time updates
- State management with Zustand

**Audio I/O**

- Microphone access via Web Audio API
- AudioPlayer for TTS output (3 channels)
- AudioWorklet for VAD processing

**Deliverables**: Working Electron app with live translation UI

### Phase 8: Testing & Optimization (Week 9)

**Comprehensive Testing**

- Boundary tests for all Core modules
- API resolver integration tests
- Client component tests

**Performance Optimization**

- Profile and optimize bottlenecks
- Reduce memory footprint where possible
- Tune chunk sizes for optimal latency

**Error Handling**

- Graceful degradation on translation failures
- Retry logic for model loading
- User-friendly error messages

**Deliverables**: Production-ready code with test coverage

## Memory Budget (16GB Apple Silicon)

**Allocation Strategy**:

- OS + System: 3GB
- Electron + Browser: 2GB
- Parakeet TDT (ASR): 1.2GB
- NLLB-200 × 3 instances: 3.6GB (1.2GB each)
- XTTS-v2 (Python backend): 2GB
- Silero VAD: 10MB
- Working memory + buffers: 3GB
- **Total**: ~14GB (within 16GB limit)

**Optimizations**:

- Use quantized models if available (int8 reduces NLLB to ~400MB each)
- Lazy load/unload inactive language models
- Web Worker isolation prevents memory leaks
- Implement memory monitoring with alerts

## Critical Files to Create (Priority Order)

### Immediate - Phase 1

1. **`tsconfig.base.json`** - Root TypeScript configuration
2. **`projects/core/tsconfig.json`** - Core package TypeScript config
3. **`projects/core/package.json`** - Update with dependencies (@huggingface/transformers, onnxruntime-web, comlink)
4. **`projects/core/vite.config.ts`** - Build configuration for library mode
5. **`projects/core/src/interfaces/ITTS.ts`** - TTS interface (critical for intonation matching)
6. **`projects/core/src/interfaces/IASR.ts`** - ASR interface
7. **`projects/core/src/interfaces/ITranslator.ts`** - Translation interface
8. **`projects/core/src/interfaces/IModelManager.ts`** - Model management interface
9. **`projects/core/src/services/model-manager/ModelRegistry.ts`** - Model metadata
10. **`projects/core/src/services/model-manager/ModelManager.ts`** - Download/cache logic

### High Priority - Phase 2-3

11. **`projects/core/src/services/vad/SileroVAD.ts`** - VAD implementation
12. **`projects/core/src/services/asr/ParakeetASR.ts`** - ASR implementation
13. **`projects/core/src/services/translation/NLLBTranslator.ts`** - Translation implementation
14. **`projects/core/src/workers/translation.worker.ts`** - Web Worker for translation
15. **`projects/core/src/workers/worker-pool.ts`** - Worker pool manager

### Critical for Differentiator - Phase 4

16. **`xtts-server/main.py`** - XTTS-v2 Python backend (FastAPI)
17. **`xtts-server/requirements.txt`** - Python dependencies
18. **`projects/core/src/services/tts/XTTSSTTS.ts`** - XTTS client
19. **`projects/core/src/services/tts/ProsodyExtractor.ts`** - Speaker embedding helper

### Pipeline & API - Phase 5-6

20. **`projects/core/src/pipeline/TranslationPipeline.ts`** - Main orchestration
21. **`projects/api/src/schema/schema.graphql`** - GraphQL schema
22. **`projects/api/src/server.ts`** - Apollo Server setup
23. **`projects/api/src/resolvers/Subscription.ts`** - Streaming resolvers

### Client - Phase 7

24. **`projects/client-app/vite.config.ts`** - Electron + Vite configuration
25. **`projects/client-app/src/apollo/client.ts`** - Apollo Client setup
26. **`projects/client-app/src/components/TranslationView/TranslationView.tsx`** - Main UI

## Immediate Next Steps

To begin implementation immediately:

1. **Update package.json files** with confirmed dependencies
2. **Create TypeScript configurations** (root + per-package)
3. **Run `pnpm install`** to install all dependencies
4. **Create Core interface files** (IASR, ITranslator, ITTS, IVAD, IModelManager)
5. **Implement ModelManager** with on-demand download logic
6. **Write first boundary test** for ModelManager
7. **Verify model download** works with Silero VAD (small 2MB model)

## Summary

This plan provides a clear, actionable path to building Voice Bridge with all ambiguities resolved:

**Confirmed Decisions:**

- ✅ On-demand model downloads (not bundled)
- ✅ Multi-client GraphQL API for scalability
- ✅ All 3 languages (Spanish, Chinese, Korean) from start
- ✅ Voice intonation matching as PRIMARY goal (XTTS-v2)
- ✅ Cross-platform production, Apple Silicon primary testing
- ✅ React + TypeScript + MUI, Vite build, Silero VAD
- ✅ Boundary tests for each module

**Key Success Factors:**

1. XTTS-v2 Python backend for prosody extraction
2. Web Worker parallelism for 3 simultaneous translations
3. Memory management to stay under 16GB
4. GraphQL subscriptions for real-time streaming
5. Clean Core/API/Client separation

The project is ambitious but feasible, with XTTS-v2 intonation matching providing clear differentiation. The 8-week phased approach ensures steady progress with testable milestones.
