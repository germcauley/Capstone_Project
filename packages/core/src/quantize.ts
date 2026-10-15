import type { RawNote } from "./segment.js";

export interface QuantizedNote {
  /** position in beats from start */
  startBeat: number;
  /** length in beats */
  durationBeats: number;
  pitch: number;
}

export interface QuantizeOptions {
  bpm: number;
  /** grid in beats, 0.25 = sixteenth in 4/4 */
  grid?: number;
  /** 0 = leave raw timing, 1 = snap fully */
  strength?: number;
  /** seconds of leading silence (count-in) to subtract */
  offsetSeconds?: number;
}

export function quantize(notes: RawNote[], opts: QuantizeOptions): QuantizedNote[] {
  const grid = opts.grid ?? 0.25;
  const strength = opts.strength ?? 1;
  const offset = opts.offsetSeconds ?? 0;
  const beatsPerSecond = opts.bpm / 60;
  const snap = (b: number) => {
    const snapped = Math.round(b / grid) * grid;
    return b + (snapped - b) * strength;
  };

  const out: QuantizedNote[] = [];
  for (const n of notes) {
    const rawStart = (n.start - offset) * beatsPerSecond;
    const rawEnd = (n.end - offset) * beatsPerSecond;
    if (rawEnd <= 0) continue;
    const start = Math.max(0, snap(Math.max(0, rawStart)));
    let end = snap(rawEnd);
    if (end - start < grid) end = start + grid;
    out.push({ startBeat: start, durationBeats: end - start, pitch: n.pitch });
  }
  // no overlap in a monophonic line: clip each note at the next onset
  for (let i = 0; i < out.length - 1; i++) {
    const limit = out[i + 1].startBeat;
    if (out[i].startBeat + out[i].durationBeats > limit) {
      out[i].durationBeats = Math.max(grid * strength || 0, limit - out[i].startBeat);
    }
  }
  return out;
}
