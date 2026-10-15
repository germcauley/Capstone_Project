import { PitchDetector } from "pitchy";

export interface PitchFrame {
  /** seconds from start of audio */
  time: number;
  /** fractional MIDI note number, null when unvoiced */
  midi: number | null;
  clarity: number;
}

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

export interface TrackOptions {
  frameSize?: number;
  hop?: number;
  minClarity?: number;
  minRms?: number;
  minHz?: number;
  maxHz?: number;
}

/** Monophonic pitch track using McLeod pitch method (pitchy). */
export function trackPitch(
  samples: Float32Array,
  sampleRate: number,
  opts: TrackOptions = {},
): PitchFrame[] {
  const frameSize = opts.frameSize ?? 2048;
  const hop = opts.hop ?? 512;
  const minClarity = opts.minClarity ?? 0.9;
  const minRms = opts.minRms ?? 0.01;
  const minHz = opts.minHz ?? 70;
  const maxHz = opts.maxHz ?? 1400;

  const detector = PitchDetector.forFloat32Array(frameSize);
  const frames: PitchFrame[] = [];
  const buf = new Float32Array(frameSize);

  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    let sum = 0;
    for (let i = 0; i < frameSize; i++) {
      const v = samples[start + i];
      buf[i] = v;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / frameSize);
    const time = (start + frameSize / 2) / sampleRate;
    if (rms < minRms) {
      frames.push({ time, midi: null, clarity: 0 });
      continue;
    }
    const [hz, clarity] = detector.findPitch(buf, sampleRate);
    const voiced = clarity >= minClarity && hz >= minHz && hz <= maxHz;
    frames.push({ time, midi: voiced ? hzToMidi(hz) : null, clarity });
  }
  return frames;
}
