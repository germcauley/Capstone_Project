import { describe, expect, it } from "vitest";
import {
  accompany, chordName, chordTones, harmonize, note, rest, toMusicXML, tonicOf, voiceChord,
  voiceLength, type Score, type Voice,
} from "./index.js";

const v = (...events: Voice["events"]): Voice => ({ events });
const C = { keyFifths: 0, mode: "major" as const, timeSig: { beats: 4, beatType: 4 } };
const names = (spans: ReturnType<typeof harmonize>, f = 0) => spans.map((s) => chordName(s.chord, f));

describe("tonicOf", () => {
  it("maps key signatures to tonics", () => {
    expect(tonicOf(0, "major")).toBe(0);
    expect(tonicOf(1, "major")).toBe(7);
    expect(tonicOf(-1, "major")).toBe(5);
    expect(tonicOf(0, "minor")).toBe(9);
    expect(tonicOf(2, "major")).toBe(2);
  });
});

describe("harmonize", () => {
  it("puts I under a C major arpeggio", () => {
    const out = harmonize(v(note(60, 4), note(64, 4), note(67, 4), note(64, 4)), C);
    expect(names(out)).toEqual(["C"]);
  });

  it("uses V under G B D and returns home", () => {
    const melody = v(
      note(60, 4), note(64, 4), note(67, 4), note(64, 4),
      note(67, 4), note(71, 4), note(74, 4), note(71, 4),
      note(60, 16),
    );
    const out = harmonize(melody, C);
    expect(names(out)).toEqual(["C", expect.stringMatching(/^G/), "C"]);
  });

  it("ends on the tonic even when the last bar is ambiguous", () => {
    const melody = v(note(64, 8), note(62, 8), note(64, 8), note(62, 8), note(64, 16));
    const out = harmonize(melody, C);
    expect(chordName(out[out.length - 1].chord, 0)).toBe("C");
  });

  it("works in a minor key", () => {
    const melody = v(note(69, 4), note(72, 4), note(76, 4), note(72, 4));
    const out = harmonize(melody, { keyFifths: 0, mode: "minor", timeSig: C.timeSig });
    expect(names(out)).toEqual(["Am"]);
  });

  it("can change chords every half bar", () => {
    const melody = v(note(60, 8), note(67, 8));
    const out = harmonize(melody, { ...C, rhythm: "half" });
    expect(out).toHaveLength(2);
    expect(out[0].start).toBe(0);
    expect(out[1].start).toBe(8);
  });

  it("spans cover the whole melody without gaps", () => {
    const melody = v(note(60, 4), note(62, 4), note(64, 4), note(65, 4), note(67, 4), rest(4), note(69, 6));
    const out = harmonize(melody, C);
    const end = out[out.length - 1];
    expect(end.start + end.duration).toBeGreaterThanOrEqual(voiceLength(melody));
    out.forEach((s, i) => i > 0 && expect(s.start).toBe(out[i - 1].start + out[i - 1].duration));
  });
});

describe("voicing", () => {
  it("keeps chord tones and stays in range", () => {
    const pcs = chordTones({ root: 7, quality: "maj", numeral: "V" });
    const out = voiceChord(pcs, null);
    expect(out.map((m) => m % 12).sort()).toEqual([...pcs].sort());
    out.forEach((m) => { expect(m).toBeGreaterThanOrEqual(48); expect(m).toBeLessThanOrEqual(67); });
  });
  it("moves little between neighbouring chords", () => {
    const a = voiceChord(chordTones({ root: 0, quality: "maj", numeral: "I" }), null);
    const b = voiceChord(chordTones({ root: 7, quality: "maj", numeral: "V" }), a);
    const move = a.reduce((s, m, i) => s + Math.abs(m - b[i]), 0);
    expect(move).toBeLessThanOrEqual(8);
  });
});

describe("accompany", () => {
  const spans = harmonize(v(note(60, 16), note(67, 16)), C);
  const total = spans.reduce((s, x) => s + x.duration, 0);

  for (const style of ["block", "bassChord", "arpeggio", "alberti"] as const) {
    it(`${style} fills every span exactly`, () => {
      const out = accompany(spans, style);
      expect(voiceLength(out)).toBe(total);
    });
  }

  it("block is one chord event per span with a bass note", () => {
    const out = accompany(spans, "block");
    expect(out.events).toHaveLength(spans.length);
    const first = out.events[0];
    expect(first.kind === "note" && first.pitches.length).toBe(4);
  });
});

describe("chord symbols in MusicXML", () => {
  it("emits harmony elements and splits notes at chord changes", () => {
    const score: Score = {
      title: "t", bpm: 100, timeSig: { beats: 4, beatType: 4 }, keyFifths: 0,
      chords: [{ start: 0, root: 0, quality: "maj" }, { start: 8, root: 7, quality: "dom7" }],
      parts: [{ id: "P1", name: "m", instrument: { program: 0, clef: "treble" }, voices: [v(note(60, 16))] }],
    };
    const xml = toMusicXML(score);
    expect(xml.match(/<harmony>/g)).toHaveLength(2);
    expect(xml).toContain("<root-step>G</root-step>");
    expect(xml).toContain(`<kind text="7">dominant</kind>`);
    expect(xml).toContain(`<tie type="start"/>`);
  });
});

describe("Ode to Joy opening", () => {
  it("gets I - V - I in the first three bars", () => {
    const melody = v(
      note(64, 4), note(64, 4), note(65, 4), note(67, 4),
      note(67, 4), note(65, 4), note(64, 4), note(62, 4),
      note(60, 4), note(60, 4), note(62, 4), note(64, 4),
      note(64, 6), note(62, 2), note(62, 8),
    );
    const out = harmonize(melody, C);
    const n = names(out);
    expect(n[0]).toBe("C");
    expect(n[1]).toMatch(/^G/);
    expect(n[2]).toBe("C");
  });
});

describe("final cadence", () => {
  it("never ends on a subdominant or mediant chord, even when the melody ends on 2", () => {
    const melody = v(
      note(64, 4), note(64, 4), note(65, 4), note(67, 4),
      note(67, 4), note(65, 4), note(64, 4), note(62, 4),
      note(60, 4), note(60, 4), note(62, 4), note(64, 4),
      note(64, 6), note(62, 2), note(62, 8),
    );
    for (const rhythm of ["bar", "half"] as const) {
      const out = harmonize(melody, { ...C, rhythm });
      expect(names(out)[out.length - 1]).toMatch(/^(C|G)/);
    }
  });
});
