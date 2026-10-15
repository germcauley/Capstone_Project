import type { Clef } from "./score.js";

export type Family = "strings" | "woodwinds" | "brass";

export interface InstrumentDef {
  id: string;
  name: string;
  family: Family;
  /** General MIDI program */
  program: number;
  clef: Clef;
  /** playable sounding range, inclusive MIDI */
  lo: number;
  hi: number;
}

export const INSTRUMENTS: Record<string, InstrumentDef> = {
  fl: { id: "fl", name: "Flute", family: "woodwinds", program: 73, clef: "treble", lo: 60, hi: 96 },
  ob: { id: "ob", name: "Oboe", family: "woodwinds", program: 68, clef: "treble", lo: 58, hi: 91 },
  cl: { id: "cl", name: "Clarinet", family: "woodwinds", program: 71, clef: "treble", lo: 50, hi: 91 },
  bsn: { id: "bsn", name: "Bassoon", family: "woodwinds", program: 70, clef: "bass", lo: 34, hi: 72 },
  hn: { id: "hn", name: "Horn", family: "brass", program: 60, clef: "treble", lo: 41, hi: 77 },
  tpt: { id: "tpt", name: "Trumpet", family: "brass", program: 56, clef: "treble", lo: 55, hi: 82 },
  tbn: { id: "tbn", name: "Trombone", family: "brass", program: 57, clef: "bass", lo: 40, hi: 72 },
  tuba: { id: "tuba", name: "Tuba", family: "brass", program: 58, clef: "bass", lo: 28, hi: 58 },
  vn1: { id: "vn1", name: "Violin I", family: "strings", program: 40, clef: "treble", lo: 55, hi: 96 },
  vn2: { id: "vn2", name: "Violin II", family: "strings", program: 40, clef: "treble", lo: 55, hi: 91 },
  va: { id: "va", name: "Viola", family: "strings", program: 41, clef: "treble", lo: 48, hi: 84 },
  vc: { id: "vc", name: "Cello", family: "strings", program: 42, clef: "bass", lo: 36, hi: 76 },
  cb: { id: "cb", name: "Double Bass", family: "strings", program: 43, clef: "bass", lo: 28, hi: 60 },
};

export type EnsembleId = "quartet" | "chamber" | "orchestra";

export const ENSEMBLES: Record<EnsembleId, { name: string; instruments: string[] }> = {
  quartet: { name: "String quartet", instruments: ["vn1", "vn2", "va", "vc"] },
  chamber: { name: "Chamber ensemble", instruments: ["fl", "cl", "hn", "vn1", "vn2", "va", "vc", "cb"] },
  orchestra: {
    name: "Full orchestra",
    instruments: ["fl", "ob", "cl", "bsn", "hn", "tpt", "tbn", "tuba", "vn1", "vn2", "va", "vc", "cb"],
  },
};
