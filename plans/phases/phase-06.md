# Phase 06: GraphQL API & WebSocket Server

## Objective
Expose the pipeline over GraphQL (control/text) and binary WebSockets (audio in/out) with multi-client support.

## Inputs
- Pipeline from Phase 05.
- Schema draft for queries/mutations/subscriptions.

## Tasks
- [ ] Define `projects/api/src/schema/schema.graphql` with queries (`serverInfo`, `availableModels`, `session`, `activeSessions`), mutations (`createSession`, `stopSession`, `uploadAudioFile`, `downloadModel`), and subscriptions (`streamTranscription`, `streamTranslation`, `sessionStatus`).
- [ ] Set up Apollo Server + Express + `graphql-ws` subscriptions.
- [ ] Build binary WebSocket server on a dedicated port for audio: one input socket + per-language output sockets.
- [ ] Implement `SessionManager.ts` for lifecycle tracking and cleanup.
- [ ] Add integration tests for GraphQL resolvers and subscription flows.

## Outputs
- Running API server exposing GraphQL and audio WebSocket endpoints.
- Session management with multiple concurrent clients.

## Acceptance
- GraphQL schema validates; `pnpm test --filter api` (or similar) passes resolver/subscription tests.
- Audio WebSocket echo/integration test streams audio in and per-language audio out.
- Sessions are cleaned up on disconnect; no dangling workers.

## Constraints / Notes
- Keep audio out of GraphQL; only control/text flows over GraphQL.
- Each language gets its own output channel to avoid mixing.
