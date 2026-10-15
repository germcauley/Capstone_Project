import type { PitchFrame } from "./pitch.js";

export interface RawNote {
  /** seconds */
  start: number;
  end: number;
  /** integer MIDI pitch */
  pitch: number;
}

export interface SegmentOptions {
  /** shortest note kept, seconds */
  minDuration?: number;
  /** unvoiced gap bridged inside one note, seconds */
  maxGap?: number;
}

/** Group pitch frames into notes: runs of the same rounded pitch. */
export function segmentNotes(
  frames: PitchFrame[],
  opts: SegmentOptions = {},
): RawNote[] {
  const minDuration = opts.minDuration ?? 0.08;
  const maxGap = opts.maxGap ?? 0.05;
  if (frames.length < 2) return [];
  const hop = frames[1].time - frames[0].time;

  // 3-frame median smoothing of rounded pitch to kill single-frame glitches
  const rounded = frames.map((f) => (f.midi === null ? null : Math.round(f.midi)));
  const smooth = rounded.map((p, i) => {
    const w = [rounded[i - 1], p, rounded[i + 1]].filter(
      (v): v is number => v !== null && v !== undefined,
    );
    if (p === null || w.length < 3) return p;
    return w.sort((a, b) => a - b)[1];
  });

  const notes: RawNote[] = [];
  let cur: RawNote | null = null;
  for (let i = 0; i < frames.length; i++) {
    const p = smooth[i];
    const t = frames[i].time;
    if (p !== null && cur && cur.pitch === p && t - cur.end <= maxGap + hop * 1.5) {
      cur.end = t + hop / 2;
    } else if (p !== null) {
      if (cur) notes.push(cur);
      cur = { start: t - hop / 2, end: t + hop / 2, pitch: p };
    }
    // unvoiced frame: leave cur open; gap check happens on next voiced frame
  }
  if (cur) notes.push(cur);
  return notes.filter((n) => n.end - n.start >= minDuration);
}
