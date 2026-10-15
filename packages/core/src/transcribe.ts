import { trackPitch, type TrackOptions } from "./pitch.js";
import { segmentNotes, type RawNote, type SegmentOptions } from "./segment.js";

/**
 * Monophonic audio take -> timed notes in seconds.
 * Quantizing is separate so the user can re-snap a take without re-analysing audio.
 */
export function transcribeTake(
  samples: Float32Array,
  sampleRate: number,
  opts: TrackOptions & SegmentOptions = {},
): RawNote[] {
  return segmentNotes(trackPitch(samples, sampleRate, opts), opts);
}
