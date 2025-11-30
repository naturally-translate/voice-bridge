# Phase 07: React Web Client

## Objective
Ship a React/MUI web app that configures sessions, streams audio, and displays translations with per-language playback.

## Inputs
- GraphQL + WebSocket endpoints from Phase 06.
- Vite React scaffold (`projects/client-app`).

## Tasks
- [ ] Create Vite + React + TS app in `projects/client-app/`; configure MUI theme.
- [ ] Implement core components: `TranscriptionView`, `TranslationView` (3 panels), `AudioControls`, `ModelStatus`, `ServerConnection`.
- [ ] Set up Apollo Client with subscriptions for real-time text/status.
- [ ] Implement Web Audio capture + AudioWorklet for low-latency microphone input; stream to binary WebSocket.
- [ ] Implement per-language audio playback for output sockets.
- [ ] Add UI tests/smoke tests for connection + live updates.

## Outputs
- Running web client with live translation UI and per-language audio playback.

## Acceptance
- App connects to server, streams microphone audio, displays live transcription/translation, and plays back per-language audio.
- Basic component tests pass (`pnpm test --filter client-app` or equivalent).
- Connection errors and model download states are surfaced in UI.

## Constraints / Notes
- Keep audio players separate per language; do not mix streams.
- Provide user-configurable server URL and language toggles.
