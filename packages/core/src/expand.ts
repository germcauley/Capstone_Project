import { insertNote, placedNotes, type Placed } from "./edit.js";
import { chordName, rootName, tonicOf, type ChordSpan, type Mode } from "./harmony.js";
import { measureLength, voiceLength, type Score, type Voice } from "./score.js";

export type ExpandMode = "continue" | "vary" | "develop";
export type Form = "AB" | "ABA" | "AABA";

export interface ExpandRequest {
  mode: ExpandMode;
  melody: Voice;
  keyFifths: number;
  keyMode: Mode;
  timeSig: Score["timeSig"];
  bpm: number;
  /** bars to generate for continue; ignored for vary (same length) and develop (derived from form) */
  bars: number;
  form?: Form;
  /** chords already chosen for the melody, if any */
  chords?: ChordSpan[];
  /** candidates wanted */
  count?: number;
}

/** What a generator hands back before validation: [midi | null for rest, sixteenths]. */
export interface RawCandidate {
  label?: string;
  notes: unknown;
}

export interface Candidate {
  label: string;
  /** positions relative to the start of the generated section */
  notes: Placed[];
  /** things we had to repair, shown to the user */
  repairs: string[];
}

export interface MelodyGenerator {
  id: string;
  generate(req: ExpandRequest): Promise<RawCandidate[]>;
}

export const ALLOWED_DURATIONS = [1, 2, 3, 4, 6, 8, 12, 16];
const FORM_SECTIONS: Record<Form, number> = { AB: 2, ABA: 3, AABA: 4 };

export function barsToGenerate(req: ExpandRequest): number {
  const mLen = measureLength(req.timeSig);
  const have = Math.max(1, Math.ceil(voiceLength(req.melody) / mLen));
  if (req.mode === "vary") return have;
  if (req.mode === "develop") return have * (FORM_SECTIONS[req.form ?? "AABA"] - 1);
  return Math.max(1, req.bars);
}

/** Long sections are slow and costly to generate, so ask for fewer ideas. */
export function candidateCount(req: ExpandRequest): number {
  if (req.count) return req.count;
  return barsToGenerate(req) >= 12 ? 2 : 3;
}

export function sectionStart(req: ExpandRequest): number {
  const mLen = measureLength(req.timeSig);
  return Math.ceil(voiceLength(req.melody) / mLen) * mLen;
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (m: number) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

function melodyByBar(voice: Voice, mLen: number): string {
  const placed = placedNotes(voice);
  const bars = Math.max(1, Math.ceil(voiceLength(voice) / mLen));
  const lines: string[] = [];
  for (let b = 0; b < bars; b++) {
    const items = placed
      .filter((n) => n.start >= b * mLen && n.start < (b + 1) * mLen)
      .map((n) => `[${n.pitches[0]},${n.duration}]`);
    lines.push(`bar ${b + 1}: ${items.join(" ") || "(rest)"}`);
  }
  return lines.join("\n");
}

export const SYSTEM_PROMPT =
  "You are a melody composition engine inside a music notation app. " +
  "You reply with ONE JSON object and nothing else: no prose, no markdown, no code fences.";

export function buildPrompt(req: ExpandRequest): string {
  const mLen = measureLength(req.timeSig);
  const tonic = tonicOf(req.keyFifths, req.keyMode);
  const bars = barsToGenerate(req);
  const total = bars * mLen;
  const count = candidateCount(req);
  const pitches = placedNotes(req.melody).map((n) => n.pitches[0]);
  const lo = pitches.length ? Math.min(...pitches) : 60;
  const hi = pitches.length ? Math.max(...pitches) : 72;
  const chordLine = req.chords?.length
    ? `Chords under the melody: ${req.chords.map((c) => chordName(c.chord, req.keyFifths)).join(" | ")}`
    : "No chords chosen yet.";

  const task: Record<ExpandMode, string> = {
    continue:
      `Write the next ${bars} bars that continue this melody. Reuse its motif and rhythm vocabulary, ` +
      `develop it rather than repeating it, and finish with a clear cadence.`,
    vary:
      `Write ${bars} bars that are a variation of this melody: keep its overall contour, phrase shape and harmony, ` +
      `but change rhythm, add or remove passing notes, or alter some pitches so it is recognisably related but fresh.`,
    develop:
      `The melody is section A. Complete the form ${req.form ?? "AABA"} by writing the remaining ${FORM_SECTIONS[req.form ?? "AABA"] - 1} ` +
      `sections back to back (${bars} bars in total, each section ${bars / (FORM_SECTIONS[req.form ?? "AABA"] - 1)} bars). ` +
      `A' repeats with variation, B contrasts with new material and a different register or direction, ` +
      `and a returning A should end on the tonic.`,
  };

  return [
    `Key: ${rootName(tonic, req.keyFifths)} ${req.keyMode}. Time signature: ${req.timeSig.beats}/${req.timeSig.beatType}. Tempo: ${req.bpm} bpm.`,
    `Time unit: sixteenth notes. One bar = ${mLen} sixteenths. A note is [midi, sixteenths]; a rest is [null, sixteenths].`,
    `Allowed durations: ${ALLOWED_DURATIONS.join(", ")}. Stay mostly in the key. Keep pitches within MIDI ${Math.max(36, lo - 7)}..${Math.min(96, hi + 7)} (the melody spans ${noteName(lo)}-${noteName(hi)}).`,
    chordLine,
    ``,
    `Melody:`,
    melodyByBar(req.melody, mLen),
    ``,
    `Task: ${task[req.mode]}`,
    ``,
    `Give ${count} clearly different candidates. Each candidate's durations must add up to exactly ${total} sixteenths.`,
    `Reply with exactly this shape:`,
    `{"candidates":[{"label":"<2-4 word description>","notes":[[64,4],[null,2],[67,2]]}]}`,
  ].join("\n");
}

/** Pull a JSON object (or array) out of model text, tolerating fences and chatter. */
export function parseModelJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const open = cleaned.search(/[{[]/);
  if (open === -1) throw new Error("No JSON in model reply");
  const closeChar = cleaned[open] === "{" ? "}" : "]";
  const close = cleaned.lastIndexOf(closeChar);
  if (close <= open) throw new Error("Unterminated JSON in model reply");
  return JSON.parse(cleaned.slice(open, close + 1));
}

export function parseCandidates(text: string): RawCandidate[] {
  const data = parseModelJson(text) as { candidates?: unknown } | unknown[];
  const list = Array.isArray(data) ? data : (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(list)) throw new Error("Reply has no candidates list");
  return list.filter((c): c is RawCandidate => !!c && typeof c === "object" && "notes" in c);
}

function nearestDuration(d: number): number {
  let best = ALLOWED_DURATIONS[0];
  for (const a of ALLOWED_DURATIONS) if (Math.abs(a - d) < Math.abs(best - d)) best = a;
  return best;
}

function foldInto(pitch: number, lo: number, hi: number): number {
  let p = pitch;
  while (p < lo) p += 12;
  while (p > hi) p -= 12;
  return Math.min(hi, Math.max(lo, p));
}

/** Validate and repair one raw candidate. Returns null if it is unusable. */
export function normalizeCandidate(raw: RawCandidate, req: ExpandRequest, index = 0): Candidate | null {
  if (!Array.isArray(raw.notes)) return null;
  const mLen = measureLength(req.timeSig);
  const target = barsToGenerate(req) * mLen;
  const existing = placedNotes(req.melody).map((n) => n.pitches[0]);
  const lo = Math.max(36, (existing.length ? Math.min(...existing) : 60) - 9);
  const hi = Math.min(96, (existing.length ? Math.max(...existing) : 72) + 9);
  const scale = scaleSet(req);

  const repairs: string[] = [];
  const notes: Placed[] = [];
  let cursor = 0;
  let outOfKey = 0;

  for (const item of raw.notes as unknown[]) {
    let pitch: number | null;
    let dur: number;
    if (Array.isArray(item)) {
      pitch = item[0] === null || item[0] === undefined ? null : Number(item[0]);
      dur = Number(item[1]);
    } else if (item && typeof item === "object") {
      const o = item as { pitch?: unknown; duration?: unknown };
      pitch = o.pitch === null || o.pitch === undefined ? null : Number(o.pitch);
      dur = Number(o.duration);
    } else continue;
    if (!Number.isFinite(dur) || dur <= 0) continue;
    if (pitch !== null && !Number.isFinite(pitch)) continue;

    const snapped = nearestDuration(Math.round(dur));
    if (snapped !== dur && !repairs.includes("snapped odd durations")) repairs.push("snapped odd durations");
    if (cursor >= target) {
      if (!repairs.includes("trimmed extra notes")) repairs.push("trimmed extra notes");
      break;
    }
    const len = Math.min(snapped, target - cursor);
    if (pitch !== null) {
      const rounded = Math.round(pitch);
      const p = foldInto(rounded, lo, hi);
      if (p !== rounded && !repairs.includes("moved notes into range")) repairs.push("moved notes into range");
      if (!scale.has(((p % 12) + 12) % 12)) outOfKey++;
      notes.push({ start: cursor, duration: len, pitches: [p] });
    }
    cursor += len;
  }

  if (notes.length < 3) return null;
  if (new Set(notes.map((n) => n.pitches[0])).size < 2) return null;
  if (outOfKey / notes.length > 0.3) return null;

  if (cursor < target) {
    repairs.push("lengthened last note to fill the section");
    const last = notes[notes.length - 1];
    const end = last.start + last.duration;
    last.duration = Math.min(16, last.duration + (target - end));
  }

  const label = typeof raw.label === "string" && raw.label.trim() ? raw.label.trim().slice(0, 40) : `Option ${index + 1}`;
  return { label, notes, repairs };
}

function scaleSet(req: ExpandRequest): Set<number> {
  const tonic = tonicOf(req.keyFifths, req.keyMode);
  const steps = req.keyMode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10, 11];
  return new Set(steps.map((s) => (tonic + s) % 12));
}

export interface ExpandResult {
  candidates: Candidate[];
  /** number of raw candidates the model returned that failed validation */
  rejected: number;
}

/** Ask a generator for candidates, validate them, retry once if none survive. */
export async function expandMelody(gen: MelodyGenerator, req: ExpandRequest): Promise<ExpandResult> {
  const seen = new Set<string>();
  const original = placedNotes(req.melody).map((n) => n.pitches[0]).join(",");
  let rejected = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raws = await gen.generate(req);
    const good: Candidate[] = [];
    raws.forEach((raw, i) => {
      const c = normalizeCandidate(raw, req, i);
      if (!c) { rejected++; return; }
      const sig = c.notes.map((n) => `${n.pitches[0]}:${n.duration}`).join(",");
      const same = req.mode === "vary" && c.notes.map((n) => n.pitches[0]).join(",") === original;
      if (seen.has(sig) || same) { rejected++; return; }
      seen.add(sig);
      good.push(c);
    });
    if (good.length) return { candidates: good, rejected };
  }
  return { candidates: [], rejected };
}

/** Append a candidate after the melody (continue / develop). */
export function appendCandidate(voice: Voice, cand: Candidate, start: number): Voice {
  return cand.notes.reduce(
    (v, n) => insertNote(v, { ...n, start: n.start + start }),
    voice,
  );
}

/** HTTP-style completion function: system + user prompt in, model text out. */
export type Complete = (system: string, prompt: string) => Promise<string>;

export function llmGenerator(id: string, complete: Complete): MelodyGenerator {
  return {
    id,
    async generate(req) {
      const text = await complete(SYSTEM_PROMPT, buildPrompt(req));
      return parseCandidates(text);
    },
  };
}
