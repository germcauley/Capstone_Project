import { chordTones, type ChordSpan } from "./harmony.js";
import { note, rest, type ScoreEvent, type Voice } from "./score.js";

export type AccompanimentStyle = "block" | "bassChord" | "arpeggio" | "alberti";

const LOW = 48; // C3
const HIGH = 67; // G4
const BASS_LOW = 36; // C2
const BASS_HIGH = 52; // E3

/** Closest voicing (chord tones inside C3-G4) to the previous one, for smooth motion. */
export function voiceChord(pcs: number[], previous: number[] | null): number[] {
  const options: number[][] = pcs.map((pc) => {
    const out: number[] = [];
    for (let m = LOW; m <= HIGH; m++) if (m % 12 === pc) out.push(m);
    return out;
  });
  let best: number[] = [];
  let bestCost = Infinity;
  const target = previous ?? pcs.map(() => 58);
  const pick = (i: number, acc: number[]) => {
    if (i === options.length) {
      const sorted = [...acc].sort((a, b) => a - b);
      if (new Set(sorted).size !== sorted.length) return;
      // keep it compact: span within an octave and a bit
      const span = sorted[sorted.length - 1] - sorted[0];
      if (span > 14) return;
      const ref = [...target].sort((a, b) => a - b);
      let cost = span * 0.2;
      for (let k = 0; k < sorted.length; k++) {
        cost += Math.abs(sorted[k] - (ref[k] ?? ref[ref.length - 1]));
      }
      if (cost < bestCost) { bestCost = cost; best = sorted; }
      return;
    }
    for (const m of options[i]) pick(i + 1, [...acc, m]);
  };
  pick(0, []);
  return best.length ? best : pcs.map((pc) => LOW + ((pc - LOW) % 12 + 12) % 12);
}

function bassNote(rootPc: number): number {
  for (let m = BASS_HIGH; m >= BASS_LOW; m--) if (m % 12 === rootPc) return m;
  return BASS_LOW + rootPc;
}

/** Turn chord spans into a playable accompaniment line (chords as multi-pitch events). */
export function accompany(spans: ChordSpan[], style: AccompanimentStyle): Voice {
  const events: ScoreEvent[] = [];
  let cursor = 0;
  let prev: number[] | null = null;

  for (const span of spans) {
    if (span.start > cursor) events.push(rest(span.start - cursor));
    const pcs = chordTones(span.chord);
    const upper = voiceChord(pcs.slice(0, 3), prev);
    prev = upper;
    const bass = bassNote(span.chord.root);
    const len = span.duration;

    if (style === "block") {
      events.push(note([bass, ...upper], len));
    } else if (style === "bassChord") {
      const beat = Math.min(4, len);
      events.push(note(bass, beat));
      if (len > beat) events.push(note(upper, len - beat));
    } else {
      const [lo, mid, hi] = upper;
      const unit = 2;
      const pattern = style === "arpeggio" ? [bass, lo, mid, hi, mid, lo] : [lo, hi, mid, hi];
      const lowBass = style === "alberti" ? bass : null;
      let used = 0;
      let i = 0;
      while (len - used >= unit) {
        const pitch = lowBass !== null && i % 4 === 0 ? [bass, pattern[i % 4]] : pattern[i % pattern.length];
        events.push(note(pitch, unit));
        used += unit;
        i++;
      }
      if (len - used > 0) {
        const last = events[events.length - 1];
        if (last && last.kind === "note") last.duration += len - used;
        else events.push(note(bass, len - used));
      }
    }
    cursor = span.start + span.duration;
  }
  return { events };
}
