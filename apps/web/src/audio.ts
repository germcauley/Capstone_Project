import { SplendidGrandPiano } from "smplr";
import { toPlayback, type Score } from "@composer/core";

let ctx: AudioContext | null = null;
let piano: SplendidGrandPiano | null = null;
let stopFns: (() => void)[] = [];

export async function play(score: Score, onEnd: () => void): Promise<void> {
  ctx ??= new AudioContext();
  await ctx.resume();
  if (!piano) {
    piano = new SplendidGrandPiano(ctx);
    await piano.load;
  }
  stop();
  const t0 = ctx.currentTime + 0.1;
  let end = 0;
  for (const n of toPlayback(score)) {
    const s = piano.start({ note: n.midi, time: t0 + n.start, duration: n.duration, velocity: 80 });
    stopFns.push(s);
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
