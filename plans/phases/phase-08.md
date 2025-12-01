# Phase 08: Recording Storage & Playback

## Objective

Persist session artifacts (audio + transcripts + metadata) via a pluggable storage layer and expose playback.

## Inputs

- Pipeline hooks for input/output streams.
- Storage interface shape (`IRecordingStorage`).

## Tasks

- [ ] Implement `IRecordingStorage` interface and `LocalFileStorage` backend (filesystem, configurable base path).
- [ ] Integrate storage hooks into the pipeline to write input/output chunks incrementally.
- [ ] Implement `TranscriptFormatter.ts` for txt/json/timestamps/srt formats.
- [ ] Implement `AudioConcatenator.ts` and `SessionFinalizer.ts` for session closure.
- [ ] Add GraphQL queries/mutations for listing and retrieving recordings; stream audio for playback.
- [ ] Add tests for create → append → finalize → retrieve flows.

## Outputs

- Recording folder structure under `{basePath}/{yyyy-mm}/{timestamp-name}/...` with transcripts and audio per language.
- API/UI support for listing and playing back recordings.

## Acceptance

- End-to-end recording test passes (create, append chunks, finalize, retrieve).
- Session finalization produces all transcript formats and concatenated audio per language.
- Playback works via API/UI without blocking live sessions.

## Constraints / Notes

- All sessions are recorded by default; ensure storage failures degrade gracefully without breaking the live pipeline.
- Keep per-utterance chunks plus concatenated outputs; store speaker embedding (`embedding.bin`) for re-synthesis.
