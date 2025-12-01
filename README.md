# Voice Bridge

TypeScript-based monorepo for real-time translation, speech, and control plane tooling. The repository is organized so most of the logic lives in a reusable Core package, with a thin GraphQL API shim and an Electron client that consumes that API.

## Repository layout

- `projects/core` — shared, API-agnostic logic (audio pipelines, translation/ASR/TTS abstractions, configuration, logging, utilities). This is the primary place new features should land.
- `projects/api-gateway` — GraphQL API that wraps Core capabilities; responsible for transport, authentication, and subscription plumbing, not business rules.
- `projects/client-app` — Electron app that talks to the GraphQL API (Apollo Client), renders live transcripts/translations, and manages control-plane actions (start/stop, language selection, model swaps).

The workspace is managed with `pnpm` (`pnpm-workspace.yaml` scopes all `projects/*`). Each package is expected to expose its own `src` entrypoint, build output (`dist/`), and tests.

## Getting started

1. Prerequisites: Node.js 22.12+ (LTS), `pnpm` 10.x (see `packageManager` in `package.json`).
2. Install dependencies: `pnpm install`.
3. Develop per package:
   - Core: `pnpm --filter core test` / `pnpm --filter core dev` (when added).
   - API Gateway: `pnpm --filter api-gateway dev` to run the GraphQL server against local Core builds.
   - Client: `pnpm --filter client-app dev` to launch the Electron shell against the API.

> Tip: use `pnpm -r lint` or `pnpm -r test` to run commands across all packages when scripts are added.

## Architecture guidelines

- **Core-first**: Domain logic, model wrappers, and orchestration belong in `core` and should be framework-agnostic. The API should import Core modules and keep GraphQL resolvers thin (validation, mapping, and wiring only).
- **API as a shim**: GraphQL should expose queries/mutations/subscriptions like `health`, `startPipeline`, `streamTranscription`, and `streamAudio`, delegating work to Core services.
- **Client as control plane**: The Electron renderer uses the GraphQL API (Apollo Client) for data and subscriptions; the main process can host the API or proxy to a local server.
- **Streaming-first**: Prefer streaming interfaces for ASR/translation/TTS so all three packages share the same primitives (e.g., async iterators or observables for text/audio chunks).
- **Testability**: Keep Core modules pure where possible; API/client should be integration layers with thin adapters.
