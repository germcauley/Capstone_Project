import { describe, expect, it } from "vitest";
import {
  commit, createHistory, entryCursor, insertNote, note, placedNotes, redo, removeNoteAt, rest,
  toMusicXML, undo, updateNoteAt, type Score, type Voice,
} from "./index.js";

const v = (...events: Voice["events"]): Voice => ({ events });

describe("insertNote", () => {
  it("adds a note into a rest and keeps the remainder as rest", () => {
    const out = insertNote(v(rest(8)), { start: 2, duration: 2, pitches: [60] });
    expect(out.events).toEqual([rest(2), note(60, 2)]); // trailing rests are implicit
  });
  it("overwrites covered notes and trims a partial overlap", () => {
    const out = insertNote(v(note(60, 4), note(62, 4)), { start: 2, duration: 4, pitches: [64] });
    expect(placedNotes(out).map((n) => [n.start, n.duration, n.pitches[0]])).toEqual([
      [0, 2, 60], [2, 4, 64], [6, 2, 62],
    ]);
  });
});

describe("remove / update", () => {
  it("removing a note leaves a rest", () => {
    expect(removeNoteAt(v(note(60, 4), note(62, 4)), 0).events).toEqual([rest(4), note(62, 4)]);
  });
  it("changes pitch in place", () => {
    const out = updateNoteAt(v(note(60, 4)), 0, { pitches: [61] });
    expect(out.events).toEqual([note(61, 4)]);
  });
  it("lengthening swallows the next note", () => {
    const out = updateNoteAt(v(note(60, 4), note(62, 4)), 0, { duration: 8 });
    expect(out.events).toEqual([note(60, 8)]);
  });
  it("moving a note keeps its length", () => {
    const out = updateNoteAt(v(note(60, 4), rest(8)), 0, { start: 8 });
    expect(out.events).toEqual([rest(8), note(60, 4)]);
  });
});

describe("entryCursor", () => {
  it("sits after the last note, ignoring trailing rests", () => {
    expect(entryCursor(v(note(60, 4), rest(4), note(62, 2), rest(8)))).toBe(10);
  });
});

describe("history", () => {
  it("undo and redo walk the stack", () => {
    let h = createHistory(1);
    h = commit(h, 2);
    h = commit(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = redo(h);
    expect(h.present).toBe(3);
    h = undo(undo(h));
    expect(h.present).toBe(1);
    h = commit(h, 9);
    expect(h.future).toEqual([]);
  });
});

describe("note ids", () => {
  it("tags exported notes with part, voice and start", () => {
    const score: Score = {
      title: "t", bpm: 120, timeSig: { beats: 4, beatType: 4 }, keyFifths: 0,
      parts: [{ id: "P1", name: "x", instrument: { program: 0, clef: "treble" }, voices: [v(rest(4), note(60, 4))] }],
    };
    expect(toMusicXML(score)).toContain(`id="n-P1-0-4-c0"`);
  });
});
