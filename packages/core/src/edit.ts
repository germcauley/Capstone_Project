import { note, rest, voiceLength, type Score, type ScoreEvent, type Voice } from "./score.js";

/** A note at an absolute position (in sixteenths) within one voice. */
export interface Placed {
  start: number;
  duration: number;
  pitches: number[];
  tieToNext?: boolean;
}

export function placedNotes(voice: Voice): Placed[] {
  const out: Placed[] = [];
  let pos = 0;
  for (const ev of voice.events) {
    if (ev.kind === "note") {
      out.push({ start: pos, duration: ev.duration, pitches: [...ev.pitches], tieToNext: ev.tieToNext });
    }
    pos += ev.duration;
  }
  return out;
}

/** Placed notes (non-overlapping) -> voice with rests filling the gaps. */
export function voiceFromPlacedNotes(placed: Placed[]): Voice {
  const events: ScoreEvent[] = [];
  let cursor = 0;
  for (const p of [...placed].sort((a, b) => a.start - b.start)) {
    if (p.start > cursor) events.push(rest(p.start - cursor));
    const ev = note(p.pitches, p.duration);
    if (p.tieToNext) ev.tieToNext = true;
    events.push(ev);
    cursor = p.start + p.duration;
  }
  return { events };
}

/** Insert a note, overwriting whatever it covers (trimming partial overlaps). */
export function insertNote(voice: Voice, p: Placed): Voice {
  const pEnd = p.start + p.duration;
  const kept: Placed[] = [];
  for (const q of placedNotes(voice)) {
    const qEnd = q.start + q.duration;
    if (qEnd <= p.start || q.start >= pEnd) {
      kept.push(q);
      continue;
    }
    if (q.start < p.start) kept.push({ ...q, duration: p.start - q.start, tieToNext: false });
    if (qEnd > pEnd) kept.push({ ...q, start: pEnd, duration: qEnd - pEnd });
  }
  kept.push(p);
  return voiceFromPlacedNotes(kept);
}

export function removeNoteAt(voice: Voice, start: number): Voice {
  return voiceFromPlacedNotes(placedNotes(voice).filter((n) => n.start !== start));
}

export function updateNoteAt(
  voice: Voice,
  start: number,
  patch: Partial<Pick<Placed, "start" | "duration" | "pitches" | "tieToNext">>,
): Voice {
  const target = placedNotes(voice).find((n) => n.start === start);
  if (!target) return voice;
  const without = removeNoteAt(voice, start);
  return insertNote(without, { ...target, ...patch });
}

/** Where step entry appends: right after the last note. */
export function entryCursor(voice: Voice): number {
  let pos = 0;
  let last = 0;
  for (const ev of voice.events) {
    pos += ev.duration;
    if (ev.kind === "note") last = pos;
  }
  return Math.min(last, voiceLength(voice));
}

export function mapVoice(
  score: Score,
  partId: string,
  voiceIndex: number,
  fn: (v: Voice) => Voice,
): Score {
  return {
    ...score,
    parts: score.parts.map((p) =>
      p.id !== partId
        ? p
        : { ...p, voices: p.voices.map((v, i) => (i === voiceIndex ? fn(v) : v)) },
    ),
  };
}

export function scoreLength(score: Score): number {
  return Math.max(0, ...score.parts.flatMap((p) => p.voices.map(voiceLength)));
}
