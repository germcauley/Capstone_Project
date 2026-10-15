/** Duration unit: 1 = one sixteenth note. A quarter note = 4. */
export const DIVISIONS_PER_QUARTER = 4;

export type Clef = "treble" | "bass";

export interface Instrument {
  /** General MIDI program 0-127 */
  program: number;
  clef: Clef;
  /** written-to-sounding offset in semitones (0 for concert pitch) */
  transpose?: number;
}

export interface NoteEvent {
  kind: "note";
  /** MIDI pitches; more than one = chord */
  pitches: number[];
  duration: number;
  tieToNext?: boolean;
}

export interface RestEvent {
  kind: "rest";
  duration: number;
}

export type ScoreEvent = NoteEvent | RestEvent;

/** One monophonic line inside a part. Events run back to back from bar 1. */
export interface Voice {
  events: ScoreEvent[];
}

export interface Part {
  id: string;
  name: string;
  instrument: Instrument;
  voices: Voice[];
}

export interface ChordMark {
  /** start in sixteenths, aligned to the first staff */
  start: number;
  root: number;
  quality: "maj" | "min" | "dim" | "dom7";
}

export interface Score {
  title: string;
  bpm: number;
  timeSig: { beats: number; beatType: number };
  /** key signature as circle-of-fifths count: 0=C, 1=G, -1=F, 2=D ... */
  keyFifths: number;
  mode?: "major" | "minor";
  /** chord symbols printed above the first staff */
  chords?: ChordMark[];
  parts: Part[];
}

export function measureLength(timeSig: Score["timeSig"]): number {
  return (timeSig.beats * 4 * DIVISIONS_PER_QUARTER) / timeSig.beatType;
}

export function note(pitch: number | number[], duration: number): NoteEvent {
  return { kind: "note", pitches: Array.isArray(pitch) ? pitch : [pitch], duration };
}

export function rest(duration: number): RestEvent {
  return { kind: "rest", duration };
}

export function voiceLength(voice: Voice): number {
  return voice.events.reduce((s, e) => s + e.duration, 0);
}

/** Notes placed at absolute 16th-note positions -> a voice with rests filling gaps. */
export function voiceFromPlaced(
  placed: { start: number; duration: number; pitch: number }[],
): Voice {
  const events: ScoreEvent[] = [];
  let cursor = 0;
  for (const n of [...placed].sort((a, b) => a.start - b.start)) {
    const start = Math.max(n.start, cursor);
    if (start > cursor) events.push(rest(start - cursor));
    const dur = Math.max(1, Math.min(n.duration, n.start + n.duration - start));
    events.push(note(n.pitch, dur));
    cursor = start + dur;
  }
  return { events };
}

/** Convert quantized capture output (beats) to a voice. */
export function voiceFromQuantized(
  notes: { startBeat: number; durationBeats: number; pitch: number }[],
): Voice {
  return voiceFromPlaced(
    notes.map((n) => ({
      start: Math.round(n.startBeat * DIVISIONS_PER_QUARTER),
      duration: Math.max(1, Math.round(n.durationBeats * DIVISIONS_PER_QUARTER)),
      pitch: n.pitch,
    })),
  );
}

export interface PlaybackNote {
  partId: string;
  program: number;
  midi: number;
  start: number;
  duration: number;
}

/** Flatten the score to timed notes in seconds, for the sound engine. */
export function toPlayback(score: Score): PlaybackNote[] {
  const secPerDiv = 60 / score.bpm / DIVISIONS_PER_QUARTER;
  const out: PlaybackNote[] = [];
  for (const part of score.parts) {
    for (const voice of part.voices) {
      let pos = 0;
      let held: { start: number; pitches: number[]; len: number } | null = null;
      const flush = () => {
        if (!held) return;
        for (const midi of held.pitches) {
          out.push({
            partId: part.id,
            program: part.instrument.program,
            midi: midi + (part.instrument.transpose ?? 0),
            start: held.start * secPerDiv,
            duration: held.len * secPerDiv,
          });
        }
        held = null;
      };
      for (const ev of voice.events) {
        if (ev.kind === "rest") {
          flush();
        } else {
          if (held && held.pitches.join() === ev.pitches.join()) {
            held.len += ev.duration;
          } else {
            flush();
            held = { start: pos, pitches: ev.pitches, len: ev.duration };
          }
          if (!ev.tieToNext) flush();
        }
        pos += ev.duration;
      }
      flush();
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
