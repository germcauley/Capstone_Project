import { describe, expect, it } from "vitest";
import { note, rest, toMusicXML, toPlayback, voiceFromQuantized, type Score } from "./index.js";

const base = (events: Score["parts"][0]["voices"][0]["events"], extra: Partial<Score> = {}): Score => ({
  title: "t",
  bpm: 120,
  timeSig: { beats: 4, beatType: 4 },
  keyFifths: 0,
  parts: [{ id: "P1", name: "Piano", instrument: { program: 0, clef: "treble" }, voices: [{ events }] }],
  ...extra,
});

describe("voiceFromQuantized", () => {
  it("fills leading gaps with rests", () => {
    const v = voiceFromQuantized([{ startBeat: 1, durationBeats: 1, pitch: 60 }]);
    expect(v.events).toEqual([rest(4), note(60, 4)]);
  });
});

describe("toMusicXML", () => {
  it("emits a bar per 16 sixteenths and pads the last one", () => {
    const xml = toMusicXML(base([note(60, 4), note(62, 4), note(64, 4), note(65, 4), note(67, 4)]));
    expect(xml.match(/<measure /g)).toHaveLength(2);
    expect(xml).toContain("<rest/>"); // padding in bar 2
  });
  it("splits a note across the barline with ties", () => {
    const xml = toMusicXML(base([rest(12), note(60, 8)]));
    expect(xml).toContain(`<tie type="start"/>`);
    expect(xml).toContain(`<tie type="stop"/>`);
  });
  it("spells black keys with flats in flat keys", () => {
    const xml = toMusicXML(base([note(70, 16)], { keyFifths: -1 }));
    expect(xml).toContain("<step>B</step><alter>-1</alter>");
  });
  it("writes dotted durations", () => {
    expect(toMusicXML(base([note(60, 6), note(62, 2), rest(8)]))).toContain("<dot/>");
  });
});

describe("toPlayback", () => {
  it("converts to seconds and merges ties", () => {
    const tied = { ...note(60, 4), tieToNext: true };
    const pb = toPlayback(base([tied, note(60, 4), rest(4), note(62, 4)]));
    expect(pb).toHaveLength(2);
    expect(pb[0]).toMatchObject({ midi: 60, start: 0, duration: 1 }); // 8 sixteenths @120bpm = 1s
    expect(pb[1]).toMatchObject({ midi: 62, start: 1.5 });
  });
});
