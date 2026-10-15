import { measureLength, voiceLength, type Score, type Voice } from "./score.js";
import { placedNotes } from "./edit.js";

export type Mode = "major" | "minor";
export type Quality = "maj" | "min" | "dim" | "dom7";

export interface Chord {
  /** root pitch class 0-11 */
  root: number;
  quality: Quality;
  /** roman numeral relative to the key, e.g. "V7" */
  numeral: string;
}

export interface ChordSpan {
  /** start in sixteenths */
  start: number;
  duration: number;
  chord: Chord;
}

const INTERVALS: Record<Quality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  dom7: [0, 4, 7, 10],
};
const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export function chordTones(c: Chord): number[] {
  return INTERVALS[c.quality].map((i) => (c.root + i) % 12);
}

export function rootName(pc: number, keyFifths: number): string {
  return (keyFifths < 0 ? FLAT : SHARP)[((pc % 12) + 12) % 12];
}

export function chordName(c: Chord, keyFifths: number): string {
  const suffix = { maj: "", min: "m", dim: "dim", dom7: "7" }[c.quality];
  return rootName(c.root, keyFifths) + suffix;
}

/** Tonic pitch class from key signature + mode. */
export function tonicOf(keyFifths: number, mode: Mode): number {
  const major = (((keyFifths * 7) % 12) + 12) % 12;
  return mode === "major" ? major : (major + 9) % 12;
}

interface Candidate extends Chord {
  /** extra pull toward this chord regardless of melody */
  bias: number;
  fn: "T" | "S" | "D" | "M";
}

function vocabulary(tonic: number, mode: Mode): Candidate[] {
  const c = (deg: number, quality: Quality, numeral: string, fn: Candidate["fn"], bias = 0): Candidate => ({
    root: (tonic + deg) % 12, quality, numeral, fn, bias,
  });
  if (mode === "major") {
    return [
      c(0, "maj", "I", "T", 0.3),
      c(2, "min", "ii", "S"),
      c(4, "min", "iii", "M", -0.2),
      c(5, "maj", "IV", "S", 0.1),
      c(7, "maj", "V", "D", 0.1),
      c(7, "dom7", "V7", "D"),
      c(9, "min", "vi", "M"),
      c(11, "dim", "vii°", "D", -0.5),
    ];
  }
  return [
    c(0, "min", "i", "T", 0.3),
    c(2, "dim", "ii°", "S", -0.3),
    c(3, "maj", "III", "M"),
    c(5, "min", "iv", "S", 0.1),
    c(7, "maj", "V", "D", 0.1), // harmonic minor dominant
    c(7, "dom7", "V7", "D"),
    c(8, "maj", "VI", "M"),
    c(10, "maj", "VII", "M", -0.1),
    c(11, "dim", "vii°", "D", -0.5),
  ];
}

function scalePcs(tonic: number, mode: Mode): Set<number> {
  const steps = mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10, 11];
  return new Set(steps.map((s) => (tonic + s) % 12));
}

/** How well one pitch class sits on a chord. */
function pitchFit(pc: number, chord: Chord, scale: Set<number>): number {
  const tones = chordTones(chord);
  const idx = tones.indexOf(pc);
  if (idx === 0) return 1.0;
  if (idx === 1) return 0.9;
  if (idx === 2) return 0.8;
  if (idx === 3) return 0.7;
  return scale.has(pc) ? -0.4 : -1.2;
}

const TRANSITION: Record<string, number> = {
  "D>T": 1.0, "S>D": 0.7, "T>S": 0.4, "T>D": 0.3, "M>S": 0.5, "M>D": 0.3,
  "T>M": 0.3, "S>M": 0.1, "D>M": 0.3, "S>T": 0.2, "D>S": -0.6, "M>T": 0.1,
  "T>T": -0.2, "S>S": -0.2, "D>D": -0.2, "M>M": -0.3,
};

export interface HarmonizeOptions {
  keyFifths: number;
  mode: Mode;
  timeSig: Score["timeSig"];
  /** how often chords may change */
  rhythm?: "bar" | "half";
}

/** Choose one chord per bar (or half bar) for a melody, Viterbi over a diatonic vocabulary. */
export function harmonize(melody: Voice, opts: HarmonizeOptions): ChordSpan[] {
  const mLen = measureLength(opts.timeSig);
  const half = opts.rhythm === "half" && opts.timeSig.beats % 2 === 0;
  const segLen = half ? mLen / 2 : mLen;
  const total = Math.max(voiceLength(melody), 1);
  const nSeg = Math.ceil(total / segLen);
  const beatLen = 16 / opts.timeSig.beatType;

  const tonic = tonicOf(opts.keyFifths, opts.mode);
  const vocab = vocabulary(tonic, opts.mode);
  const scale = scalePcs(tonic, opts.mode);
  const notes = placedNotes(melody);

  // emission: how well each chord fits the melody in each segment
  const emit: number[][] = [];
  for (let s = 0; s < nSeg; s++) {
    const a = s * segLen;
    const b = a + segLen;
    const row = vocab.map((ch) => {
      let score = ch.bias;
      for (const n of notes) {
        const lo = Math.max(a, n.start);
        const hi = Math.min(b, n.start + n.duration);
        if (hi <= lo) continue;
        const beats = (hi - lo) / 4;
        const onset = n.start >= a;
        const strong = !onset ? 0.8 : n.start === a ? 1.6 : n.start % beatLen === 0 ? 1.2 : 0.7;
        for (const p of n.pitches) score += beats * strong * pitchFit(p % 12, ch, scale);
      }
      return score;
    });
    emit.push(row);
  }

  // phrase-shape bias: start and end on tonic, half cadence at 4-bar ends, V before final
  const barOf = (s: number) => Math.floor((s * segLen) / mLen);
  const lastSeg = nSeg - 1;
  const phraseBias = (s: number, ch: Candidate) => {
    let b = 0;
    if (s === 0 && ch.fn === "T") b += 1.0;
    const bar = barOf(s);
    const atBarEnd = !half || (s * segLen) % mLen !== 0;
    if (s === lastSeg) {
      // end on home, or a half cadence on V; never on a pre-dominant or mediant chord
      if (ch.fn === "T") b += 2.0;
      else if (ch.fn === "D" && ch.quality !== "dim") b += 0.8;
      else b -= 0.8;
    } else if (s === lastSeg - 1 && atBarEnd && ch.fn === "D") {
      b += 0.8;
    } else if (atBarEnd && bar % 4 === 3 && ch.fn === "D" && ch.quality !== "dim") {
      b += 0.5;
    }
    return b;
  };

  // Viterbi
  const n = vocab.length;
  const best: number[][] = [];
  const back: number[][] = [];
  best.push(emit[0].map((e, j) => e + phraseBias(0, vocab[j])));
  back.push(new Array(n).fill(-1));
  for (let s = 1; s < nSeg; s++) {
    const row: number[] = [];
    const bp: number[] = [];
    for (let j = 0; j < n; j++) {
      let top = -Infinity;
      let from = 0;
      for (let i = 0; i < n; i++) {
        // repeating the same chord is mildly discouraged, other moves follow function
        const t = i === j ? -0.2 : (TRANSITION[`${vocab[i].fn}>${vocab[j].fn}`] ?? 0);
        const v = best[s - 1][i] + t * 2;
        if (v > top) { top = v; from = i; }
      }
      row.push(top + emit[s][j] + phraseBias(s, vocab[j]));
      bp.push(from);
    }
    best.push(row);
    back.push(bp);
  }

  let j = best[nSeg - 1].indexOf(Math.max(...best[nSeg - 1]));
  const path: number[] = new Array(nSeg);
  for (let s = nSeg - 1; s >= 0; s--) {
    path[s] = j;
    j = back[s][j];
  }

  return path.map((idx, s) => {
    const { root, quality, numeral } = vocab[idx];
    const start = s * segLen;
    return { start, duration: Math.min(segLen, Math.max(total, nSeg * segLen) - start), chord: { root, quality, numeral } };
  });
}
