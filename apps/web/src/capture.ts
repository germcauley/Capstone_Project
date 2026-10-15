import { analyzeFrame, type FrameAnalysis } from "@composer/core";
import { getContext } from "./audio";

export interface CaptureSettings {
  bpm: number;
  beats: number;
  beatType: number;
  /** bars to record after one count-in bar */
  bars: number;
}

export interface BeatInfo {
  phase: "count-in" | "recording";
  bar: number;
  beat: number;
}

export interface CaptureResult {
  samples: Float32Array;
  sampleRate: number;
  /** seconds in `samples` where bar 1 beat 1 sits, latency corrected */
  offsetSeconds: number;
}

export interface CaptureEvents {
  onBeat: (b: BeatInfo) => void;
  onLevel: (a: FrameAnalysis) => void;
  onDone: (r: CaptureResult) => void;
  onError: (message: string) => void;
}

const WORKLET = `
class Rec extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage({ t: currentTime, d: ch.slice(0) });
    return true;
  }
}
registerProcessor("composer-rec", Rec);
`;

let workletReady: WeakSet<AudioContext> = new WeakSet();

function click(ctx: AudioContext, when: number, accent: boolean) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = accent ? 1600 : 1100;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, when + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  osc.connect(g).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.06);
}

export async function startCapture(
  s: CaptureSettings,
  ev: CaptureEvents,
): Promise<{ stop: () => void }> {
  const ctx = getContext();
  await ctx.resume();

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    const name = (e as DOMException).name;
    ev.onError(
      name === "NotAllowedError"
        ? "Microphone blocked. Allow mic access for this site and try again."
        : name === "NotFoundError"
          ? "No microphone found."
          : `Could not open microphone: ${String(e)}`,
    );
    return { stop() {} };
  }

  if (!workletReady.has(ctx)) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    workletReady.add(ctx);
  }

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "composer-rec", { numberOfOutputs: 1, outputChannelCount: [1] });
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node).connect(mute).connect(ctx.destination);

  const chunks: Float32Array[] = [];
  let firstT: number | null = null;
  const ring = new Float32Array(2048);
  let ringFill = 0;
  let live = true;
  node.port.onmessage = (m: MessageEvent<{ t: number; d: Float32Array }>) => {
    if (!live) return;
    if (firstT === null) firstT = m.data.t;
    chunks.push(m.data.d);
    const d = m.data.d;
    ring.copyWithin(0, d.length);
    ring.set(d, ring.length - d.length);
    ringFill = Math.min(ring.length, ringFill + d.length);
  };

  const dt = (60 / s.bpm) * (4 / s.beatType);
  const t0 = ctx.currentTime + 0.4;
  const downbeat = t0 + s.beats * dt;
  const total = s.beats * (1 + s.bars);
  const end = t0 + total * dt;
  const timers: number[] = [];

  for (let i = 0; i < total; i++) {
    const inBar = i % s.beats;
    click(ctx, t0 + i * dt, inBar === 0);
    const delay = Math.max(0, (t0 + i * dt - ctx.currentTime) * 1000);
    timers.push(
      window.setTimeout(() => {
        if (!live) return;
        ev.onBeat({
          phase: i < s.beats ? "count-in" : "recording",
          bar: Math.floor(i / s.beats) + (i < s.beats ? 1 : 0),
          beat: inBar + 1,
        });
      }, delay),
    );
  }

  let raf = 0;
  const loop = () => {
    if (!live) return;
    if (ringFill >= ring.length && ctx.currentTime >= downbeat) {
      ev.onLevel(analyzeFrame(ring, ctx.sampleRate));
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  let finished = false;
  function finish(deliver: boolean) {
    if (finished) return;
    finished = true;
    live = false;
    timers.forEach(clearTimeout);
    cancelAnimationFrame(raf);
    node.port.onmessage = null;
    source.disconnect();
    node.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    if (!deliver || firstT === null || ctx.currentTime < downbeat) return;
    const len = chunks.reduce((n, c) => n + c.length, 0);
    const samples = new Float32Array(len);
    let o = 0;
    for (const c of chunks) {
      samples.set(c, o);
      o += c.length;
    }
    const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    ev.onDone({
      samples,
      sampleRate: ctx.sampleRate,
      offsetSeconds: downbeat - firstT + latency,
    });
  }

  const endTimer = window.setTimeout(() => finish(true), (end - ctx.currentTime + 0.35) * 1000);
  timers.push(endTimer);

  return { stop: () => finish(ctx.currentTime >= downbeat) };
}
