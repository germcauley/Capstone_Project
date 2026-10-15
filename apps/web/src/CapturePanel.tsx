import { useMemo, useRef, useState } from "react";
import {
  detectKey, quantize, transcribeTake, voiceFromQuantized,
  type FrameAnalysis, type RawNote, type Score, type Voice,
} from "@composer/core";
import { startCapture, type BeatInfo } from "./capture";
import { play, stop as stopPlayback } from "./audio";

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const METERS: [number, number][] = [[2, 4], [3, 4], [4, 4], [5, 4], [6, 8], [9, 8], [12, 8]];
const GRIDS: [number, string][] = [[0.25, "1/16"], [0.5, "1/8"], [1, "1/4"]];

export interface ApplyTake {
  mode: "new" | "replace";
  voice: Voice;
  clef: "treble" | "bass";
  keyFifths: number | null;
}

interface Props {
  score: Score;
  activeName: string;
  onTempo: (bpm: number) => void;
  onMeter: (beats: number, beatType: number) => void;
  onApply: (a: ApplyTake) => void;
}

type Phase = "idle" | "starting" | "count-in" | "recording" | "review";

export function CapturePanel({ score, activeName, onTempo, onMeter, onApply }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [bars, setBars] = useState(4);
  const [beat, setBeat] = useState<BeatInfo | null>(null);
  const [level, setLevel] = useState<FrameAnalysis | null>(null);
  const [error, setError] = useState("");
  const [take, setTake] = useState<{ raw: RawNote[]; offset: number } | null>(null);
  const [grid, setGrid] = useState(0.5);
  const [octave, setOctave] = useState(0);
  const [useKey, setUseKey] = useState(true);
  const handle = useRef<{ stop: () => void } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const quantized = useMemo(
    () => (take ? quantize(take.raw, { bpm: score.bpm, grid, offsetSeconds: take.offset }) : []),
    [take, score.bpm, grid],
  );
  const shifted = useMemo(
    () => quantized.map((n) => ({ ...n, pitch: n.pitch + 12 * octave })),
    [quantized, octave],
  );
  const key = useMemo(() => detectKey(shifted), [shifted]);
  const voice = useMemo(() => voiceFromQuantized(shifted), [shifted]);
  const clef = shifted.length && shifted.reduce((s, n) => s + n.pitch, 0) / shifted.length < 57 ? "bass" : "treble";

  async function record() {
    setError("");
    setPhase("starting");
    setBeat(null);
    setLevel(null);
    try {
      handle.current = await startCapture(
        { bpm: score.bpm, beats: score.timeSig.beats, beatType: score.timeSig.beatType, bars },
        {
          onBeat: (b) => {
            setBeat(b);
            setPhase(b.phase);
          },
          onLevel: setLevel,
          onDone: (r) => {
            const raw = transcribeTake(r.samples, r.sampleRate);
            if (!raw.length) {
              setError("No clear notes heard. Try humming louder, closer to the mic, or in a quieter room.");
              setPhase("idle");
              return;
            }
            setTake({ raw, offset: r.offsetSeconds });
            setOctave(0);
            setPhase("review");
          },
          onError: (m) => {
            setError(m);
            setPhase("idle");
          },
        },
      );
      setPhase((p) => (p === "starting" ? "count-in" : p));
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    }
  }

  function cancel() {
    handle.current?.stop();
    setPhase((p) => (p === "review" ? p : "idle"));
  }

  async function preview() {
    if (previewing) {
      stopPlayback();
      setPreviewing(false);
      return;
    }
    const temp: Score = {
      ...score,
      keyFifths: useKey && key ? key.fifths : score.keyFifths,
      parts: [{ id: "take", name: "Take", instrument: { program: 0, clef }, voices: [voice] }],
    };
    setPreviewing(true);
    try {
      await play(temp, () => setPreviewing(false));
    } catch {
      setPreviewing(false);
    }
  }

  const recording = phase === "starting" || phase === "count-in" || phase === "recording";
  const noteName = level?.midi != null ? `${NAMES[Math.round(level.midi) % 12]}${Math.floor(Math.round(level.midi) / 12) - 1}` : "–";
  const cents = level?.midi != null ? Math.round((level.midi - Math.round(level.midi)) * 100) : 0;

  return (
    <section className="capture" aria-label="Capture a melody">
      <div className="bar">
        <label className="field">
          Tempo
          <span className="stepper">
            <button onClick={() => onTempo(Math.max(40, score.bpm - 5))} disabled={recording} aria-label="slower">−</button>
            <input type="number" min={40} max={220} value={score.bpm} disabled={recording}
              onChange={(e) => onTempo(Math.min(220, Math.max(40, Number(e.target.value) || 100)))} />
            <button onClick={() => onTempo(Math.min(220, score.bpm + 5))} disabled={recording} aria-label="faster">+</button>
          </span>
        </label>
        <label className="field">
          Meter
          <select value={`${score.timeSig.beats}/${score.timeSig.beatType}`} disabled={recording}
            onChange={(e) => { const [b, t] = e.target.value.split("/").map(Number); onMeter(b, t); }}>
            {METERS.map(([b, t]) => <option key={`${b}/${t}`} value={`${b}/${t}`}>{b}/{t}</option>)}
          </select>
        </label>
        <label className="field">
          Bars
          <select value={bars} disabled={recording} onChange={(e) => setBars(Number(e.target.value))}>
            {[2, 4, 8, 16].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {recording ? (
          <button className="primary rec" onClick={cancel}>Stop</button>
        ) : (
          <button className="primary rec" onClick={record}>● Record</button>
        )}
      </div>

      {recording && (
        <div className="status" role="status">
          <div className="count">
            {phase === "starting" ? "Opening mic…" : phase === "count-in" ? `Count-in  ${beat?.beat ?? ""}` : `Bar ${beat?.bar ?? 1} · beat ${beat?.beat ?? 1}`}
          </div>
          <div className="meter">
            <span className="note">{noteName}</span>
            <span className="cents" aria-hidden>
              <i style={{ left: `${50 + cents / 2}%` }} />
            </span>
            <span className="level" aria-hidden><i style={{ width: `${Math.min(100, (level?.rms ?? 0) * 400)}%` }} /></span>
          </div>
          <p className="muted">Use headphones so the click stays out of the mic. Hum one note at a time.</p>
        </div>
      )}

      {error && <p role="alert" className="err">{error}</p>}

      {phase === "review" && take && (
        <div className="review">
          <p>
            <b>{shifted.length} notes</b>
            {key && <> · sounds like <b>{key.name}</b></>}
          </p>
          <div className="bar">
            <label className="field">
              Snap to
              <select value={grid} onChange={(e) => setGrid(Number(e.target.value))}>
                {GRIDS.map(([g, l]) => <option key={g} value={g}>{l}</option>)}
              </select>
            </label>
            <label className="field">
              Octave
              <select value={octave} onChange={(e) => setOctave(Number(e.target.value))}>
                <option value={-1}>Down</option><option value={0}>As sung</option><option value={1}>Up</option>
              </select>
            </label>
            {key && (
              <label className="field check">
                <input type="checkbox" checked={useKey} onChange={(e) => setUseKey(e.target.checked)} /> Set key
              </label>
            )}
          </div>
          <div className="bar">
            <button onClick={preview}>{previewing ? "Stop preview" : "Preview"}</button>
            <button className="primary" onClick={() => { onApply({ mode: "new", voice, clef, keyFifths: useKey && key ? key.fifths : null }); setTake(null); setPhase("idle"); }}>
              Add as new staff
            </button>
            <button onClick={() => { onApply({ mode: "replace", voice, clef, keyFifths: useKey && key ? key.fifths : null }); setTake(null); setPhase("idle"); }}>
              Replace “{activeName}”
            </button>
            <button onClick={() => { setTake(null); setPhase("idle"); }}>Discard</button>
          </div>
        </div>
      )}
    </section>
  );
}
