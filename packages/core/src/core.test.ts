import { describe, expect, it } from "vitest";
import { hzToMidi, quantize, segmentNotes, type PitchFrame } from "./index.js";

const frames = (pitches: (number | null)[], hop = 0.01): PitchFrame[] =>
  pitches.map((midi, i) => ({ time: i * hop, midi, clarity: 1 }));

describe("hzToMidi", () => {
  it("maps A4 to 69 and C4 to ~60", () => {
    expect(hzToMidi(440)).toBeCloseTo(69);
    expect(hzToMidi(261.63)).toBeCloseTo(60, 1);
  });
});

describe("segmentNotes", () => {
  it("groups runs of one pitch and splits on pitch change", () => {
    const f = frames([...Array(20).fill(60), ...Array(20).fill(64)]);
    const notes = segmentNotes(f);
    expect(notes.map((n) => n.pitch)).toEqual([60, 64]);
  });
  it("drops notes shorter than minDuration", () => {
    const f = frames([...Array(20).fill(60), ...Array(3).fill(72), ...Array(20).fill(60)]);
    expect(segmentNotes(f).every((n) => n.pitch === 60)).toBe(true);
  });
  it("bridges a short unvoiced gap inside one note", () => {
    const f = frames([...Array(10).fill(60), null, null, ...Array(10).fill(60)]);
    expect(segmentNotes(f)).toHaveLength(1);
  });
});

describe("quantize", () => {
  it("snaps to the grid at 120 bpm (2 beats/sec)", () => {
    const q = quantize([{ start: 0.26, end: 0.74, pitch: 60 }], { bpm: 120, grid: 0.25 });
    expect(q[0].startBeat).toBeCloseTo(0.5);
    expect(q[0].durationBeats).toBeCloseTo(1);
  });
  it("never makes a note shorter than one grid step", () => {
    const q = quantize([{ start: 0, end: 0.01, pitch: 60 }], { bpm: 120, grid: 0.25 });
    expect(q[0].durationBeats).toBeGreaterThanOrEqual(0.25);
  });
  it("strength 0 keeps raw timing", () => {
    const q = quantize([{ start: 0.3, end: 0.8, pitch: 60 }], { bpm: 120, strength: 0 });
    expect(q[0].startBeat).toBeCloseTo(0.6);
  });
});
