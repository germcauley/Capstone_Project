import { useMemo, useState } from "react";
import {
  accompany, chordName, detectMode, harmonize, placedNotes,
  type AccompanimentStyle, type ChordSpan, type Mode, type Score, type Voice,
} from "@composer/core";

export interface ApplyHarmony {
  spans: ChordSpan[];
  voice: Voice;
  mode: Mode;
}

const STYLES: [AccompanimentStyle, string][] = [
  ["block", "Block chords"],
  ["bassChord", "Bass + chord"],
  ["arpeggio", "Arpeggio"],
  ["alberti", "Alberti"],
];

interface Props {
  score: Score;
  melody: Voice;
  melodyName: string;
  hasHarmony: boolean;
  onApply: (a: ApplyHarmony) => void;
  onRemove: () => void;
}

export function HarmonyPanel({ score, melody, melodyName, hasHarmony, onApply, onRemove }: Props) {
  const notes = useMemo(() => placedNotes(melody), [melody]);
  const guessed = useMemo(
    () => detectMode(notes.map((n) => ({ pitch: n.pitches[0], durationBeats: n.duration / 4 })), score.keyFifths),
    [notes, score.keyFifths],
  );
  const [mode, setMode] = useState<Mode | "auto">("auto");
  const [rhythm, setRhythm] = useState<"bar" | "half">("bar");
  const [style, setStyle] = useState<AccompanimentStyle>("bassChord");

  const effectiveMode: Mode = mode === "auto" ? score.mode ?? guessed ?? "major" : mode;

  const preview = useMemo(
    () => (notes.length ? harmonize(melody, { keyFifths: score.keyFifths, mode: effectiveMode, timeSig: score.timeSig, rhythm }) : []),
    [melody, notes.length, score.keyFifths, score.timeSig, effectiveMode, rhythm],
  );

  function apply() {
    onApply({ spans: preview, voice: accompany(preview, style), mode: effectiveMode });
  }

  return (
    <section className="capture" aria-label="Add harmony">
      <div className="bar">
        <label className="field">
          Mode
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode | "auto")}>
            <option value="auto">Auto ({score.mode ?? guessed ?? "major"})</option>
            <option value="major">Major</option>
            <option value="minor">Minor</option>
          </select>
        </label>
        <label className="field">
          Chords change
          <select value={rhythm} onChange={(e) => setRhythm(e.target.value as "bar" | "half")}>
            <option value="bar">Every bar</option>
            <option value="half">Every half bar</option>
          </select>
        </label>
        <label className="field">
          Accompaniment
          <select value={style} onChange={(e) => setStyle(e.target.value as AccompanimentStyle)}>
            {STYLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <button className="primary rec" disabled={!notes.length} onClick={apply}>
          {hasHarmony ? "Redo harmony" : "Add harmony"}
        </button>
        {hasHarmony && <button onClick={onRemove}>Remove</button>}
      </div>
      <p className="muted prog">
        {notes.length
          ? <>For “{melodyName}”: {preview.map((s) => chordName(s.chord, score.keyFifths)).join(" · ")}</>
          : <>Pick a staff with notes in it, then add harmony.</>}
      </p>
    </section>
  );
}
