import { SplendidGrandPiano } from "smplr";
import { toPlayback, type Score } from "@composer/core";

let ctx: AudioContext | null = null;
let piano: SplendidGrandPiano | null = null;
let stopFns: (() => void)[] = [];

async function ready() {
  ctx ??= new AudioContext();
  await ctx.resume();
  if (!piano) {
    piano = new SplendidGrandPiano(ctx);
    await piano.load;
  }
  return { ctx, piano };
}

export async function play(score: Score, onEnd: () => void): Promise<void> {
  const { ctx, piano } = await ready();
  stop();
  const t0 = ctx.currentTime + 0.1;
  let end = 0;
  for (const n of toPlayback(score)) {
    stopFns.push(piano.start({ note: n.midi, time: t0 + n.start, duration: n.duration, velocity: 80 }));
    end = Math.max(end, n.start + n.duration);
  }
  const timer = window.setTimeout(onEnd, (end + 0.3) * 1000);
  stopFns.push(() => window.clearTimeout(timer));
}

export function stop() {
  stopFns.forEach((f) => f());
  stopFns = [];
  piano?.stop();
}

/** Short audition of one pitch while editing. */
export async function preview(midi: number): Promise<void> {
  const { piano } = await ready();
  piano.start({ note: midi, duration: 0.5, velocity: 75 });
}
