# Voice Bridge - Requirements Document

## Overview

Voice Bridge is a real-time multi-language translation system with **voice intonation matching** as the primary differentiator. The system captures audio input, transcribes it, translates to multiple target languages simultaneously, and synthesizes speech output that preserves the speaker's voice characteristics.

## Core Requirements

### 1. Real-Time Translation Pipeline

- **Input Sources**:
  - Live microphone audio from browser (Web Audio API)
  - Audio file upload (WAV, MP3)
  - Server-side audio device (for local deployment)
  - Server-accessible file paths (for testing/batch processing)

- **Processing Pipeline**:
  - Voice Activity Detection (VAD) using Silero VAD
  - Automatic Speech Recognition (ASR) using Distil-Whisper Large V3
  - Machine Translation using NLLB-200-distilled-600M
  - Text-to-Speech (TTS) using XTTS-v2 with prosody embeddings

- **Output**:
  - Real-time text transcription (English)
  - Real-time translated text (per target language)
  - Synthesized audio with speaker's voice characteristics (per target language)

### 2. Multi-Language Support

- **Source Language**: English (primary)
- **Target Languages** (simultaneous):
  - Spanish (es)
  - Chinese Mandarin Simplified (zh)
  - Korean (ko)

- **Fire-and-Forget Architecture**: Each language processes independently; failures in one language do not block others.

### 3. Voice Intonation Matching (Primary Differentiator)

- Extract speaker embedding from 3-6 seconds of voiced audio
- Apply speaker characteristics to all TTS synthesis
- Preserve voice timbre, pitch patterns, and speaking style across languages
- Store speaker embedding for session duration
- Fallback to neutral voice if insufficient audio for embedding extraction

### 4. Client-Server Architecture

- **Server**: Node.js process with `worker_threads` for ML processing
  - Can run locally or on remote machines
  - Handles all heavy computation
  - Manages model downloads and caching
  - GraphQL API for control and text streaming
  - WebSocket binary channels for audio streaming

- **Client**: React web application in browser
  - Configuration UI for models and sessions
  - Real-time monitoring of transcription and translation
  - Audio capture (microphone) and playback (per-language)
  - No ML processing on client side

### 5. Model Management

- On-demand model downloads from Hugging Face
- Local caching in `models/` directory
- Progress reporting during downloads
- Model swapping capability (upgrade ASR/Translation/TTS models)

### 6. Recording Storage and Playback

Recording storage enables replay of translation sessions for review, sharing, and archival purposes.

#### 6.1 Storage Requirements

- **Abstraction Layer**: Storage operations must be abstracted through an interface (`IRecordingStorage`) to allow swapping storage backends (local filesystem, cloud services, databases).

- **Initial Implementation**: Local filesystem storage with configurable base path.

- **Session Naming**: Each recording session has a human-readable name provided by the user.

#### 6.2 Folder Structure

```
{basePath}/
└── {yyyy-mm}/                                    # Year-Month grouping
    └── {yyyy-mm-dd-hh-mm-ss}-{name}/             # Session folder
        ├── session.json                          # Session metadata
        ├── embedding.bin                         # Speaker embedding for re-synthesis
        ├── input/
        │   ├── audio.wav                         # Original input audio (concatenated)
        │   ├── transcript.txt                    # Plain text transcript
        │   ├── transcript.timestamps.txt         # Transcript with timestamps
        │   ├── transcript.json                   # Structured JSON transcript
        │   └── chunks/                           # Per-utterance audio
        │       ├── utt-001.wav
        │       ├── utt-002.wav
        │       └── ...
        ├── es/                                   # Spanish outputs
        │   ├── audio.wav                         # Full concatenated audio
        │   ├── transcript.txt                    # Plain text
        │   ├── transcript.timestamps.txt         # With timestamps
        │   ├── transcript.json                   # Structured JSON
        │   ├── transcript.srt                    # SRT subtitle format
        │   └── chunks/
        │       ├── utt-001.wav
        │       └── ...
        ├── zh/                                   # Chinese outputs
        │   ├── audio.wav
        │   ├── transcript.txt
        │   ├── transcript.timestamps.txt
        │   ├── transcript.json
        │   ├── transcript.srt
        │   └── chunks/
        └── ko/                                   # Korean outputs
            ├── audio.wav
            ├── transcript.txt
            ├── transcript.timestamps.txt
            ├── transcript.json
            ├── transcript.srt
            └── chunks/
```

#### 6.3 Session Metadata (session.json)

```json
{
  "id": "uuid-here",
  "name": "meeting-with-john",
  "createdAt": "2025-12-15T14:30:45Z",
  "completedAt": "2025-12-15T14:45:30Z",
  "duration": 885.5,
  "sourceLanguage": "en",
  "targetLanguages": ["es", "zh", "ko"],
  "inputSource": "CLIENT_STREAM",
  "status": "completed",
  "utteranceCount": 42,
  "speakerEmbeddingExtracted": true
}
```

#### 6.4 Transcript Formats

**Plain Text (transcript.txt)**:
```
Hello, how are you today?
I'm doing well, thank you for asking.
Let's discuss the project timeline.
```

**With Timestamps (transcript.timestamps.txt)**:
```
[00:00.000 - 00:02.500] Hello, how are you today?
[00:03.200 - 00:06.100] I'm doing well, thank you for asking.
[00:07.500 - 00:10.800] Let's discuss the project timeline.
```

**Structured JSON (transcript.json)**:
```json
{
  "utterances": [
    {
      "id": "utt-001",
      "startTime": 0.0,
      "endTime": 2.5,
      "text": "Hello, how are you today?",
      "confidence": 0.95
    },
    {
      "id": "utt-002",
      "startTime": 3.2,
      "endTime": 6.1,
      "text": "I'm doing well, thank you for asking.",
      "confidence": 0.92
    }
  ]
}
```

**SRT Subtitle Format (transcript.srt)** - For translated outputs:
```
1
00:00:00,000 --> 00:00:02,500
Hola, ¿cómo estás hoy?

2
00:00:03,200 --> 00:00:06,100
Estoy bien, gracias por preguntar.

3
00:00:07,500 --> 00:00:10,800
Vamos a discutir el cronograma del proyecto.
```

#### 6.5 Storage Interface

```typescript
interface IRecordingStorage {
  // Session lifecycle
  createSession(name: string, config: SessionConfig): Promise<RecordingSession>;
  finalizeSession(sessionId: string): Promise<RecordingMetadata>;

  // Input recording
  appendInputAudio(sessionId: string, audio: Buffer, utteranceId?: string): Promise<void>;
  appendInputTranscript(sessionId: string, utterance: TranscriptEntry): Promise<void>;

  // Output recording (per language)
  appendOutputAudio(sessionId: string, language: string, audio: Buffer, utteranceId?: string): Promise<void>;
  appendOutputTranscript(sessionId: string, language: string, utterance: TranscriptEntry): Promise<void>;

  // Speaker embedding
  saveSpeakerEmbedding(sessionId: string, embedding: Buffer): Promise<void>;
  getSpeakerEmbedding(sessionId: string): Promise<Buffer | null>;

  // Retrieval
  getSession(sessionId: string): Promise<RecordingSession | null>;
  listSessions(filter?: SessionFilter): Promise<RecordingMetadata[]>;

  // Playback helpers
  getInputAudio(sessionId: string): Promise<ReadableStream>;
  getOutputAudio(sessionId: string, language: string): Promise<ReadableStream>;
  getUtteranceAudio(sessionId: string, utteranceId: string, language?: string): Promise<Buffer>;
}

interface TranscriptEntry {
  utteranceId: string;
  startTime: number;
  endTime: number;
  text: string;
  confidence?: number;
  isFinal: boolean;
}

interface SessionFilter {
  startDate?: Date;
  endDate?: Date;
  name?: string;
  status?: 'recording' | 'finalizing' | 'completed' | 'failed';
}
```

#### 6.6 Recording Behavior

- **Automatic Recording**: All sessions are recorded by default (can be disabled via configuration)
- **Streaming Writes**: Audio and transcripts are written incrementally during the session
- **Chunked Audio**: Per-utterance audio files are created as they complete
- **Concatenation**: Full audio files are created during session finalization
- **Transcript Generation**: All transcript formats are generated during finalization
- **Speaker Embedding**: Saved after extraction for potential re-synthesis with future TTS models

### 7. Platform Requirements

- **Primary Development**: Apple Silicon (16GB RAM)
- **Production**: Cross-platform (macOS, Windows, Linux)
- **Memory Budget**: ~10GB server-side, leaving ~6GB headroom on 16GB machine
- **Latency Target**: <4 seconds end-to-end (audio input to translated audio output)

### 8. API Requirements

- **GraphQL API**: Queries, mutations, and subscriptions for control and text streaming
- **WebSocket Binary Protocol**: For audio input and per-language audio output
- **Session Management**: Create, start, pause, resume, stop sessions
- **Multi-client Support**: Multiple browser clients can connect to single server

## Non-Functional Requirements

### Security

- Path traversal protection for file access
- Session isolation between clients
- No sensitive data in logs

### Reliability

- Graceful degradation on component failures
- Automatic retry for transient errors
- Clear error messages to users

### Performance

- Streaming architecture throughout (no batch processing of full audio)
- Parallel translation workers (one per language)
- Efficient memory usage with worker thread isolation

### Usability

- First-run model download with progress indication
- Clear session status and pipeline state
- Easy replay of recorded sessions

## Future Considerations (Post-MVP)

- Additional language support
- Cloud storage backends (S3, GCS)
- Database storage for metadata
- Export to video formats with subtitles
- Multi-speaker detection and separation
- Real-time collaboration features
