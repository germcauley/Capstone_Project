import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { decodeWav, trackPitch, segmentNotes, quantize } from "../src/index.js";

const dir = new URL("../../../legacy/sample_audio_files/", import.meta.url).pathname;
const names = process.argv[2] ? [process.argv[2]] : readdirSync(dir).filter((f) => f.endsWith(".wav"));
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const name = (m: number) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

for (const file of names) {
  const { samples, sampleRate } = decodeWav(new Uint8Array(readFileSync(join(dir, file))));
  const secs = samples.length / sampleRate;
  const frames = trackPitch(samples, sampleRate);
  const voiced = frames.filter((f) => f.midi !== null).length;
  const raw = segmentNotes(frames);
  const q = quantize(raw, { bpm: 100, grid: 0.25 });
  console.log(`\n== ${file}: ${secs.toFixed(1)}s @ ${sampleRate}Hz, voiced ${(100 * voiced / frames.length).toFixed(0)}%, ${raw.length} notes`);
  console.log(raw.slice(0, 24).map((n) => `${name(n.pitch)}(${n.start.toFixed(2)}-${n.end.toFixed(2)})`).join(" "));
  console.log("quantized@100bpm:", q.slice(0, 16).map((n) => `${name(n.pitch)}@${n.startBeat.toFixed(2)}x${n.durationBeats.toFixed(2)}`).join(" "));
}
