# Phase 01: Foundation & Core Abstractions

## Objective

Boot the toolchain, enforce strict TypeScript defaults, and prove the model download path with a working ModelManager test.

## Inputs

- Runtimes via ASDF: Node 22.12.x (LTS), Python 3.11.9, Poetry 1.8.3, pnpm 10.12.x.
- Monorepo packages: API gateway (`projects/api`, aka api-gateway), web client (`projects/client-app`), root configs.

## Tasks

- [ ] Create `.tool-versions` with the runtime versions above; install ASDF plugins (nodejs, python, poetry, pnpm) and run `asdf install`.
- [ ] Add TypeScript configs (`tsconfig.base.json`, `projects/api/tsconfig.json`) with strict mode enabled.
- [ ] Update package manifests with core dependencies: `@huggingface/transformers`, `@ffmpeg-installer/ffmpeg`, `fluent-ffmpeg`, `ws`, `@apollo/server`, `graphql-ws`, `comlink`.
- [ ] Run `pnpm install` at repo root to hydrate all workspaces.
- [ ] Create interfaces under `projects/api/src/interfaces/`: `IASR.ts`, `ITranslator.ts`, `ITTS.ts`, `IVAD.ts`, `IModelManager.ts`.
- [ ] Implement `ModelRegistry.ts` + `ModelManager.ts` in `projects/api/src/services/model-manager/` for on-demand downloads to `models/`.
- [ ] Add the first boundary test for ModelManager using the Silero VAD model (small download).

## Outputs

- `.tool-versions`, TypeScript configs checked in.
- Installed dependencies across workspaces.
- Interface stubs and ModelManager implementation compiled without errors.
- Boundary test proving Silero VAD download/cache path.

## Acceptance

- `pnpm install` succeeds and leaves lockfiles updated.
- `pnpm test --filter model-manager` (or equivalent) passes, downloading Silero VAD to `models/`.
- `pnpm -C projects/api tsc --noEmit` passes.

## Constraints / Notes

- Keep model cache under `models/` in repo root; avoid bundling models.
- Default to strict TypeScript; no implicit `any`.
- Keep ModelManager resilient to partial downloads (resume/verify hashes when available).
