# Composer

Hum or play a melody, get a staff, edit it, hear it back, then grow it: more staves, harmony, melody expansion, and eventually orchestral arrangement. Web app, works on phones.

## Layout

- `packages/core` pure TypeScript: score model, pitch tracking, quantize, MusicXML export, edit commands, undo history
- `apps/web` React + Vite. Verovio renders the staff, smplr plays a sampled piano
- `legacy/` the original Streamlit capstone (Basic Pitch + Qwen chords), kept for reference

## Run

```bash
pnpm install
pnpm test                          # core unit tests
pnpm --filter @composer/web dev    # http://localhost:5173
pnpm spike                         # pitch-track legacy/sample_audio_files
```

## Status

Done: score model, staff render, playback, piano roll + staff editing, step entry keyboard, undo/redo, add staves, mic hum capture (click track, tempo + meter, key suggestion, review before adding).
Next: Basic Pitch transcription path, harmony, expand melody, orchestration.
