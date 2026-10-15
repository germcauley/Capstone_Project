import type { QuantizedNote } from "./quantize.js";

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
/** circle-of-fifths position of the major key on each pitch class */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export interface KeyGuess {
  tonic: number;
  mode: "major" | "minor";
  /** key signature to use in the score */
  fifths: number;
  name: string;
  /** correlation, -1..1 */
  confidence: number;
}

function correlate(a: number[], b: number[]) {
  const ma = a.reduce((s, x) => s + x, 0) / 12;
  const mb = b.reduce((s, x) => s + x, 0) / 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Krumhansl-Schmuckler key estimate from duration-weighted pitch classes. */
export function detectKey(notes: Pick<QuantizedNote, "pitch" | "durationBeats">[]): KeyGuess | null {
  if (!notes.length) return null;
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[((n.pitch % 12) + 12) % 12] += n.durationBeats;

  let best: KeyGuess | null = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ["major", "minor"] as const) {
      const profile = mode === "major" ? MAJOR : MINOR;
      const rotated = profile.map((_, i) => profile[(i - tonic + 12) % 12]);
      const r = correlate(hist, rotated);
      if (!best || r > best.confidence) {
        const majorPc = mode === "major" ? tonic : (tonic + 3) % 12;
        const fifths = MAJOR_FIFTHS[majorPc];
        const names = fifths < 0 ? FLAT : SHARP;
        best = { tonic, mode, fifths, name: `${names[tonic]} ${mode}`, confidence: r };
      }
    }
  }
  return best;
}
