import { describe, expect, it } from "vitest";
import { detectKey, quantize, transcribeTake } from "./index.js";

const SR = 44100;

/** Sine tones at the given MIDI pitches and times, silence elsewhere. */
function synth(notes: { midi: number; start: number; dur: number }[], total: number): Float32Array {
  const out = new Float32Array(Math.round(total * SR));
  for (const n of notes) {
    const hz = 440 * 2 ** ((n.midi - 69) / 12);
    const a = Math.round(n.start * SR);
    const b = Math.min(out.length, Math.round((n.start + n.dur) * SR));
    for (let i = a; i < b; i++) {
      const edge = Math.min(1, (i - a) / 200, (b - i) / 200);
      out[i] = 0.5 * edge * Math.sin((2 * Math.PI * hz * (i - a)) / SR);
    }
  }
  return out;
}

describe("transcribeTake + quantize", () => {
  const tune = [
    { midi: 60, start: 0.0, dur: 0.45 },
    { midi: 62, start: 0.5, dur: 0.45 },
    { midi: 64, start: 1.0, dur: 0.95 },
    { midi: 67, start: 2.0, dur: 0.45 },
  ];

  it("recovers pitches and beat positions at 120 bpm", () => {
    const raw = transcribeTake(synth(tune, 3), SR);
    expect(raw.map((n) => n.pitch)).toEqual([60, 62, 64, 67]);
    const q = quantize(raw, { bpm: 120, grid: 0.25 });
    expect(q.map((n) => n.startBeat)).toEqual([0, 1, 2, 4]);
    expect(q[2].durationBeats).toBeCloseTo(2, 0);
  });

  it("subtracts the count-in offset", () => {
    const shifted = tune.map((n) => ({ ...n, start: n.start + 2 }));
    const raw = transcribeTake(synth(shifted, 5), SR);
    const q = quantize(raw, { bpm: 120, grid: 0.25, offsetSeconds: 2 });
    expect(q.map((n) => n.startBeat)).toEqual([0, 1, 2, 4]);
  });

  it("ignores quiet noise", () => {
    const noise = new Float32Array(SR * 2).map(() => (Math.random() - 0.5) * 0.004);
    expect(transcribeTake(noise, SR)).toEqual([]);
  });
});

describe("detectKey", () => {
  const seq = (pitches: number[]) => pitches.map((pitch) => ({ pitch, durationBeats: 1 }));

  it("finds G major from a G major tune", () => {
    const k = detectKey(seq([67, 71, 74, 71, 67, 69, 71, 72, 71, 69, 67, 66, 67]))!;
    expect(k.name).toBe("G major");
    expect(k.fifths).toBe(1);
  });
  it("finds A minor and maps to zero sharps", () => {
    const k = detectKey(seq([69, 72, 76, 72, 69, 71, 72, 71, 69, 68, 69]))!;
    expect(k.name).toBe("A minor");
    expect(k.fifths).toBe(0);
  });
  it("uses flat spelling for flat keys", () => {
    const k = detectKey(seq([65, 69, 72, 69, 65, 67, 69, 70, 69, 67, 65]))!;
    expect(k.name).toBe("F major");
    expect(k.fifths).toBe(-1);
  });
  it("returns null for no notes", () => {
    expect(detectKey([])).toBeNull();
  });
});

import { detectMode } from "./index.js";

describe("detectMode", () => {
  const seq = (pitches: number[]) => pitches.map((pitch) => ({ pitch, durationBeats: 1 }));
  it("calls Ode to Joy C major even though E is the most common note", () => {
    const ode = seq([64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62]);
    expect(detectMode(ode, 0)).toBe("major");
  });
  it("calls an A-centred tune A minor in the C signature", () => {
    expect(detectMode(seq([69, 72, 71, 69, 68, 69, 76, 72, 69]), 0)).toBe("minor");
  });
  it("is null with no notes", () => {
    expect(detectMode([], 0)).toBeNull();
  });
});
