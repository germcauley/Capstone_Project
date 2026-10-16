import { Soundfont, SplendidGrandPiano } from "smplr";
import { toPlayback, type Score } from "@composer/core";

/** General MIDI program -> smplr soundfont instrument name. Anything unlisted falls back to piano. */
const GM_NAMES: Record<number, string> = {
  40: "violin", 41: "viola", 42: "cello", 43: "contrabass", 46: "orchestral_harp",
  56: "trumpet", 57: "trombone", 58: "tuba", 60: "french_horn",
  68: "oboe", 70: "bassoon", 71: "clarinet", 73: "flute",
};

interface Voice {
  start(o: { note: number; time: number; duration: number; velocity: number }): () => void;
  stop(): void;
}

let ctx: AudioContext | null = null;
const loaded = new Map<string, Promise<Voice>>();
/** Instruments whose samples have finished loading. stop() must act on these synchronously. */
const ready = new Set<Voice>();
let stopFns: (() => void)[] = [];

export function getContext(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

function instrumentFor(program: number): Promise<Voice> {
  const c = getContext();
  const name = GM_NAMES[program] ?? "piano";
  let p = loaded.get(name);
  if (!p) {
    if (name === "piano") {
      const piano = new SplendidGrandPiano(c);
      p = piano.load.then(() => piano as unknown as Voice);
    } else {
      const sf = new Soundfont(c, { instrument: name });
      p = sf.load.then(() => sf as unknown as Voice);
    }
    p.catch(() => loaded.delete(name));
    loaded.set(name, p);
  }
  return p;
}

export async function play(score: Score, onEnd: () => void): Promise<void> {
  const c = getContext();
  await c.resume();
  const notes = toPlayback(score);
  const programs = [...new Set(notes.map((n) => n.program))];
  const voices = new Map<number, Voice>();
  await Promise.all(programs.map(async (pr) => voices.set(pr, await instrumentFor(pr))));
  voices.forEach((v) => ready.add(v));

  // must be synchronous: an async stop would run after the notes below are queued and cancel them
  stop();
  const t0 = c.currentTime + 0.1;
  let end = 0;
  for (const n of notes) {
    const v = voices.get(n.program)!;
    const velocity = n.program === 0 ? 80 : 90;
    stopFns.push(v.start({ note: n.midi, time: t0 + n.start, duration: n.duration, velocity }));
    end = Math.max(end, n.start + n.duration);
  }
  const timer = window.setTimeout(onEnd, (end + 0.3) * 1000);
  stopFns.push(() => window.clearTimeout(timer));
}

export function stop() {
  stopFns.forEach((f) => f());
  stopFns = [];
  ready.forEach((v) => v.stop());
}

/** Short audition of one pitch while editing. */
export async function preview(midi: number): Promise<void> {
  await getContext().resume();
  const piano = await instrumentFor(0);
  piano.start({ note: midi, time: getContext().currentTime, duration: 0.5, velocity: 75 });
}
