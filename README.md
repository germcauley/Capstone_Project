# Composer

Hum or play a melody, get a staff, edit it, hear it back, then grow it: more staves, harmony, melody expansion, and eventually orchestral arrangement. Web app, works on phones.

## Layout

- `packages/core` pure TypeScript: score model, pitch tracking, quantize, MusicXML export, edit commands, undo history
- `apps/web` React + Vite. Verovio renders the staff, smplr plays a sampled piano
- `apps/proxy` tiny local server that runs generation (Claude CLI on your plan in dev, Anthropic API in prod)
- `legacy/` the original Streamlit capstone (Basic Pitch + Qwen chords), kept for reference

## Run

```bash
pnpm install
pnpm test                          # unit tests (core + proxy)
pnpm dev                           # web on http://localhost:5173 + generator proxy on :8787
pnpm --filter @composer/web dev:lan   # expose to a phone on your network (UI only, proxy stays local)
pnpm spike                         # pitch-track legacy/sample_audio_files
```

## Generation (expand melody)

`MelodyGenerator` is the seam. The proxy picks a provider:

- default: the local `claude` CLI, headless, on your own plan login. No API key. Local use only.
- `ANTHROPIC_API_KEY=... ` set: Anthropic Messages API (model `claude-sonnet-5-5`, override with `COMPOSER_MODEL`).
- `COMPOSER_PROVIDER=cli|api` forces one.

Model output is never trusted: it is parsed, snapped to allowed durations, folded into range, trimmed or padded to the exact bar count, and rejected if too chromatic.

## Status

Done: score model, staff render, playback, piano roll + staff editing, step entry keyboard, undo/redo, add staves, mic hum capture (click track, tempo + meter, key suggestion, review before adding).
Also: rule-based harmony (Viterbi chords, chord symbols, four accompaniment styles).
Also: expand melody (Continue / Vary / Develop-to-form, 3 candidates, ghost preview, validated).
Next: Basic Pitch transcription path, orchestration.
