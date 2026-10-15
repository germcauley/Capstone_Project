import { useEffect, useMemo, useRef, useState } from "react";
import {
  appendCandidate, detectMode, expandMelody, measureLength, placedNotes, sectionStart,
  type Candidate, type ChordSpan, type ExpandMode, type ExpandRequest, type Form, type Part, type Placed, type Score,
} from "@composer/core";
import { proxyGenerator, proxyHealth } from "./generator";
import { play, stop } from "./audio";

export interface GhostNotes {
  partId: string;
  notes: Placed[];
}

interface Props {
  score: Score;
  part: Part;
  onGhost: (g: GhostNotes | null) => void;
  onAccept: (cand: Candidate, mode: ExpandMode) => void;
}

const MODES: [ExpandMode, string, string][] = [
  ["continue", "Continue", "Write what comes next"],
  ["vary", "Vary", "Same shape, fresh notes"],
  ["develop", "Develop", "Grow it into a full form"],
];

function chordsFrom(score: Score): ChordSpan[] | undefined {
  if (!score.chords?.length) return undefined;
  const mLen = measureLength(score.timeSig);
  return score.chords.map((c, i, all) => ({
    start: c.start,
    duration: (all[i + 1]?.start ?? c.start + mLen) - c.start,
    chord: { root: c.root, quality: c.quality, numeral: "" },
  }));
}

function Mini({ notes, bars }: { notes: Placed[]; bars: number }) {
  const ps = notes.map((n) => n.pitches[0]);
  const lo = Math.min(...ps);
  const hi = Math.max(...ps, lo + 7);
  const total = Math.max(1, bars);
  return (
    <svg viewBox="0 0 120 36" className="mini" aria-hidden>
      {notes.map((n, i) => (
        <rect key={i} x={(n.start / total) * 120} y={32 - ((n.pitches[0] - lo) / (hi - lo)) * 28}
          width={Math.max(2, (n.duration / total) * 120 - 1)} height={4} rx={1.5} fill="var(--accent)" />
      ))}
    </svg>
  );
}

export function ExpandPanel({ score, part, onGhost, onAccept }: Props) {
  const melody = part.voices[0];
  const notes = useMemo(() => placedNotes(melody), [melody]);
  const [mode, setMode] = useState<ExpandMode>("continue");
  const [bars, setBars] = useState(4);
  const [form, setForm] = useState<Form>("AABA");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ mode: ExpandMode; candidates: Candidate[]; rejected: number; req: ExpandRequest } | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [provider, setProvider] = useState<string | null | undefined>(undefined);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const run = useRef(0);

  useEffect(() => {
    proxyHealth().then(setProvider);
  }, []);

  useEffect(() => {
    setResult(null);
    setPicked(null);
    onGhost(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part.id, mode]);

  const keyMode = score.mode ?? detectMode(notes.map((n) => ({ pitch: n.pitches[0], durationBeats: n.duration / 4 })), score.keyFifths) ?? "major";

  async function generate() {
    const id = ++run.current;
    setState("loading");
    setError("");
    setResult(null);
    setPicked(null);
    onGhost(null);
    const req: ExpandRequest = {
      mode, melody, keyFifths: score.keyFifths, keyMode, timeSig: score.timeSig, bpm: score.bpm,
      bars, form, chords: chordsFrom(score),
    };
    try {
      const out = await expandMelody(proxyGenerator, req);
      if (id !== run.current) return;
      if (!out.candidates.length) {
        setError(`The model's ideas didn't pass the checks (${out.rejected} rejected). Try again.`);
        setState("error");
        return;
      }
      setResult({ mode, candidates: out.candidates, rejected: out.rejected, req });
      setState("idle");
      pick(0, out.candidates, req);
    } catch (e) {
      if (id !== run.current) return;
      setError((e as Error).message);
      setState("error");
    }
  }

  function absolute(c: Candidate, req: ExpandRequest): Placed[] {
    const start = req.mode === "vary" ? 0 : sectionStart(req);
    return c.notes.map((n) => ({ ...n, start: n.start + start }));
  }

  function pick(i: number, cands = result?.candidates, req = result?.req) {
    if (!cands || !req) return;
    setPicked(i);
    onGhost({ partId: part.id, notes: absolute(cands[i], req) });
  }

  async function preview(i: number) {
    if (!result) return;
    if (previewing === i) {
      stop();
      setPreviewing(null);
      return;
    }
    const c = result.candidates[i];
    const voice = result.req.mode === "vary"
      ? { events: [] as Part["voices"][0]["events"] }
      : melody;
    const merged = result.req.mode === "vary"
      ? appendCandidate(voice, c, 0)
      : appendCandidate(voice, c, sectionStart(result.req));
    setPreviewing(i);
    try {
      await play({ ...score, parts: [{ ...part, voices: [merged] }] }, () => setPreviewing(null));
    } catch {
      setPreviewing(null);
    }
  }

  const totalBars = result
    ? Math.max(1, Math.ceil(result.candidates[0].notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0) / measureLength(score.timeSig)))
    : 1;

  return (
    <section className="capture" aria-label="Expand melody">
      <div className="bar">
        <span className="seg">
          {MODES.map(([m, label]) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{label}</button>
          ))}
        </span>
        {mode === "continue" && (
          <label className="field">
            Bars
            <select value={bars} onChange={(e) => setBars(Number(e.target.value))}>
              {[2, 4, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        {mode === "develop" && (
          <label className="field">
            Form
            <select value={form} onChange={(e) => setForm(e.target.value as Form)}>
              <option value="AB">A B</option>
              <option value="ABA">A B A</option>
              <option value="AABA">A A B A</option>
            </select>
          </label>
        )}
        <button className="primary rec" disabled={!notes.length || state === "loading"} onClick={generate}>
          {state === "loading" ? "Thinking…" : result ? "Try again" : "Generate 3 ideas"}
        </button>
      </div>
      <p className="muted prog">
        {MODES.find(([m]) => m === mode)?.[2]} for “{part.name}”.{" "}
        {provider === undefined ? "" : provider ? `Using ${provider}.` : "Generator offline: run `pnpm dev` in the project folder."}
      </p>
      {state === "loading" && <p role="status" className="muted">Asking the model. Short sections take 10–30 seconds; long ones can take a couple of minutes.</p>}
      {state === "error" && <p role="alert" className="err">{error}</p>}

      {result && (
        <ul className="cands">
          {result.candidates.map((c, i) => (
            <li key={i} className={i === picked ? "on" : ""}>
              <button className="cand" onClick={() => pick(i)} aria-pressed={i === picked}>
                <Mini notes={c.notes} bars={totalBars * measureLength(score.timeSig)} />
                <span className="label">{c.label}</span>
                <span className="muted">{c.notes.length} notes{c.repairs.length ? ` · fixed: ${c.repairs.join(", ")}` : ""}</span>
              </button>
              <div className="bar">
                <button onClick={() => preview(i)}>{previewing === i ? "Stop" : "Preview"}</button>
                <button className="primary" onClick={() => { onAccept(c, result.mode); setResult(null); setPicked(null); onGhost(null); }}>
                  {result.mode === "vary" ? "Add as new staff" : "Add to staff"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
