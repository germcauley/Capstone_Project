import { describe, expect, it } from "vitest";
import {
  appendCandidate, barsToGenerate, buildPrompt, expandMelody, llmGenerator, note, normalizeCandidate,
  candidateCount, parseCandidates, placedNotes, sectionStart, voiceLength, type ExpandRequest, type MelodyGenerator, type Voice,
} from "./index.js";

const melody: Voice = {
  events: [
    note(64, 4), note(64, 4), note(65, 4), note(67, 4),
    note(67, 4), note(65, 4), note(64, 4), note(62, 4),
  ],
};
const req = (over: Partial<ExpandRequest> = {}): ExpandRequest => ({
  mode: "continue", melody, keyFifths: 0, keyMode: "major",
  timeSig: { beats: 4, beatType: 4 }, bpm: 100, bars: 2, ...over,
});

const bar = (pitches: number[]) => pitches.map((p) => [p, 4]);

describe("request geometry", () => {
  it("continue uses requested bars, vary matches the melody, develop follows the form", () => {
    expect(barsToGenerate(req({ bars: 4 }))).toBe(4);
    expect(barsToGenerate(req({ mode: "vary" }))).toBe(2);
    expect(barsToGenerate(req({ mode: "develop", form: "AABA" }))).toBe(6);
    expect(barsToGenerate(req({ mode: "develop", form: "AB" }))).toBe(2);
  });
  it("new section starts at the next bar line", () => {
    expect(sectionStart(req())).toBe(32);
  });
});

describe("candidateCount", () => {
  it("asks for 3 ideas normally and 2 for long sections", () => {
    expect(candidateCount(req({ bars: 4 }))).toBe(3);
    expect(candidateCount(req({ mode: "develop", form: "AABA", melody: { events: Array.from({ length: 16 }, () => note(60, 4)) } }))).toBe(2);
    expect(candidateCount(req({ count: 1 }))).toBe(1);
  });
});

describe("buildPrompt", () => {
  it("states key, bar length, the melody and the exact target length", () => {
    const p = buildPrompt(req());
    expect(p).toContain("C major");
    expect(p).toContain("One bar = 16 sixteenths");
    expect(p).toContain("bar 1: [64,4] [64,4] [65,4] [67,4]");
    expect(p).toContain("add up to exactly 32 sixteenths");
  });
  it("describes the form for develop", () => {
    expect(buildPrompt(req({ mode: "develop", form: "ABA" }))).toContain("ABA");
  });
});

describe("parseCandidates", () => {
  const json = `{"candidates":[{"label":"Rising","notes":[[60,4],[62,4]]}]}`;
  it("reads plain JSON", () => {
    expect(parseCandidates(json)).toHaveLength(1);
  });
  it("strips fences and chatter", () => {
    expect(parseCandidates("Sure!\n```json\n" + json + "\n```\nHope that helps")).toHaveLength(1);
  });
  it("accepts a bare array", () => {
    expect(parseCandidates(`[{"notes":[[60,4]]}]`)).toHaveLength(1);
  });
  it("throws on junk", () => {
    expect(() => parseCandidates("no json here")).toThrow();
  });
});

describe("normalizeCandidate", () => {
  it("accepts a clean candidate", () => {
    const c = normalizeCandidate({ label: "A", notes: [...bar([67, 65, 64, 62]), ...bar([60, 62, 64, 60])] }, req());
    expect(c).not.toBeNull();
    expect(c!.repairs).toEqual([]);
    expect(c!.notes).toHaveLength(8);
  });
  it("trims overlong candidates to the target", () => {
    const c = normalizeCandidate({ notes: [...bar([60, 62, 64, 65]), ...bar([67, 65, 64, 62]), ...bar([60, 62, 64, 65])] }, req())!;
    const end = c.notes[c.notes.length - 1];
    expect(end.start + end.duration).toBe(32);
    expect(c.repairs).toContain("trimmed extra notes");
  });
  it("pads short candidates by lengthening the last note", () => {
    const c = normalizeCandidate({ notes: [...bar([60, 62, 64, 65]), [67, 4], [65, 4]] }, req())!;
    const end = c.notes[c.notes.length - 1];
    expect(end.start + end.duration).toBe(32);
  });
  it("folds wild pitches into range", () => {
    const c = normalizeCandidate({ notes: [[100, 4], ...bar([62, 64, 65]), ...bar([60, 62, 64, 65]).slice(0, 4)] }, req())!;
    expect(Math.max(...c.notes.map((n) => n.pitches[0]))).toBeLessThanOrEqual(76);
    expect(c.repairs).toContain("moved notes into range");
  });
  it("snaps odd durations", () => {
    const c = normalizeCandidate({ notes: [[60, 5], [62, 5], [64, 6], [65, 4], ...bar([67, 65, 64, 62])] }, req())!;
    expect(c.repairs).toContain("snapped odd durations");
    c.notes.forEach((n) => expect([1, 2, 3, 4, 6, 8, 12, 16]).toContain(n.duration));
  });
  it("rejects chromatic mush, too-short and single-pitch candidates", () => {
    expect(normalizeCandidate({ notes: bar([61, 63, 66, 68, 70, 61, 63, 66]) }, req())).toBeNull();
    expect(normalizeCandidate({ notes: [[60, 16]] }, req())).toBeNull();
    expect(normalizeCandidate({ notes: bar([60, 60, 60, 60, 60, 60, 60, 60]) }, req())).toBeNull();
    expect(normalizeCandidate({ notes: "nope" }, req())).toBeNull();
  });
  it("keeps rests as gaps", () => {
    const c = normalizeCandidate({ notes: [[60, 4], [null, 4], [64, 4], [65, 4], ...bar([67, 65, 64, 62])] }, req())!;
    expect(c.notes[1].start).toBe(8);
  });
});

describe("expandMelody", () => {
  const ok = { label: "Good", notes: [...bar([67, 65, 64, 62]), ...bar([60, 62, 64, 60])] };

  it("returns validated candidates and counts rejects", async () => {
    const gen: MelodyGenerator = { id: "fake", generate: async () => [ok, { notes: "bad" }] };
    const r = await expandMelody(gen, req());
    expect(r.candidates).toHaveLength(1);
    expect(r.rejected).toBe(1);
  });
  it("retries once when nothing survives", async () => {
    let calls = 0;
    const gen: MelodyGenerator = { id: "fake", generate: async () => (++calls === 1 ? [{ notes: [] }] : [ok]) };
    const r = await expandMelody(gen, req());
    expect(calls).toBe(2);
    expect(r.candidates).toHaveLength(1);
  });
  it("drops duplicates and, for vary, a copy of the original", async () => {
    const copy = { notes: placedNotes(melody).map((n) => [n.pitches[0], n.duration]) };
    const gen: MelodyGenerator = { id: "fake", generate: async () => [copy, copy] };
    const r = await expandMelody(gen, req({ mode: "vary" }));
    expect(r.candidates).toHaveLength(0);
  });
  it("llmGenerator parses whatever the completion returns", async () => {
    let seen = "";
    const gen = llmGenerator("llm", async (_s, p) => {
      seen = p;
      return "```json\n" + JSON.stringify({ candidates: [ok] }) + "\n```";
    });
    const r = await expandMelody(gen, req());
    expect(seen).toContain("Melody:");
    expect(r.candidates[0].label).toBe("Good");
  });
});

describe("appendCandidate", () => {
  it("places the section after the melody", () => {
    const c = normalizeCandidate({ notes: [...bar([67, 65, 64, 62]), ...bar([60, 62, 64, 60])] }, req())!;
    const out = appendCandidate(melody, c, sectionStart(req()));
    expect(voiceLength(out)).toBe(64);
    expect(placedNotes(out)[8].start).toBe(32);
  });
});
