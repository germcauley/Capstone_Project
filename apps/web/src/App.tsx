import { useEffect, useMemo, useRef, useState } from "react";
import {
  commit, createHistory, entryCursor, insertNote, mapVoice, measureLength, placedNotes,
  redo, removeNoteAt, toMusicXML, undo, updateNoteAt, type History, type Score,
} from "@composer/core";
import { demoScore } from "./demo";
import { renderMusicXML } from "./render";
import { play, preview, stop } from "./audio";
import { PianoRoll, PART_COLORS, type Sel } from "./PianoRoll";
import { Keyboard } from "./Keyboard";

const DURATIONS: [number, string][] = [[1, "1/16"], [2, "1/8"], [3, "1/8."], [4, "1/4"], [6, "1/4."], [8, "1/2"], [16, "Whole"]];
type View = "staff" | "roll";

export function App() {
  const [hist, setHist] = useState<History<Score>>(() => createHistory(demoScore));
  const score = hist.present;
  const [view, setView] = useState<View>("staff");
  const [sel, setSel] = useState<Sel | null>(null);
  const [partId, setPartId] = useState(score.parts[0].id);
  const [duration, setDuration] = useState(4);
  const [cursor, setCursor] = useState<number | null>(null);
  const [svg, setSvg] = useState("");
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const staffBox = useRef<HTMLDivElement>(null);
  const renderSeq = useRef(0);

  const measure = measureLength(score.timeSig);
  const xml = useMemo(() => toMusicXML(score), [score]);

  useEffect(() => {
    const seq = ++renderSeq.current;
    const width = staffBox.current?.clientWidth ?? 800;
    renderMusicXML(xml, width).then(
      (s) => seq === renderSeq.current && setSvg(s),
      (e) => setError(String(e)),
    );
  }, [xml]);

  // highlight the selected note in the engraved staff
  useEffect(() => {
    const root = staffBox.current;
    if (!root) return;
    root.querySelectorAll("g.note.sel").forEach((el) => el.classList.remove("sel"));
    if (sel) root.querySelectorAll(`[id^="n-${sel.partId}-${sel.voice}-${sel.start}-"]`).forEach((el) => el.classList.add("sel"));
  }, [svg, sel, view]);

  const edit = (fn: (s: Score) => Score) => setHist((h) => commit(h, fn(h.present)));
  const voiceOf = (id: string) => score.parts.find((p) => p.id === id)!.voices[0];
  const selNote = sel ? placedNotes(score.parts.find((p) => p.id === sel.partId)!.voices[sel.voice]).find((n) => n.start === sel.start) : undefined;

  function addAt(id: string, start: number, pitch: number, dur = duration) {
    edit((s) => mapVoice(s, id, 0, (v) => insertNote(v, { start, duration: dur, pitches: [pitch] })));
    setSel({ partId: id, voice: 0, start });
    setCursor(start + dur);
    void preview(pitch);
  }

  function stepEnter(midi: number) {
    const at = cursor ?? entryCursor(voiceOf(partId));
    addAt(partId, at, midi);
  }

  function addRest() {
    setCursor((c) => (c ?? entryCursor(voiceOf(partId))) + duration);
  }

  function nudge(semi: number) {
    if (!sel || !selNote) return;
    const pitches = selNote.pitches.map((p) => Math.min(108, Math.max(21, p + semi)));
    edit((s) => mapVoice(s, sel.partId, sel.voice, (v) => updateNoteAt(v, sel.start, { pitches })));
    void preview(pitches[pitches.length - 1]);
  }

  function setDur(d: number) {
    setDuration(d);
    if (sel && selNote) edit((s) => mapVoice(s, sel.partId, sel.voice, (v) => updateNoteAt(v, sel.start, { duration: d })));
  }

  function del() {
    if (!sel) return;
    edit((s) => mapVoice(s, sel.partId, sel.voice, (v) => removeNoteAt(v, sel.start)));
    setSel(null);
  }

  function addStaff(clef: "treble" | "bass") {
    const id = `P${score.parts.length + 1}`;
    edit((s) => ({
      ...s,
      parts: [...s.parts, { id, name: `${clef === "bass" ? "Bass" : "Staff"} ${s.parts.length + 1}`, instrument: { program: 0, clef }, voices: [{ events: [] }] }],
    }));
    setPartId(id);
    setCursor(null);
  }

  function onStaffClick(e: React.MouseEvent) {
    const g = (e.target as Element).closest("g.note");
    const m = g?.id.match(/^n-(.+)-(\d+)-(\d+)-c\d+$/);
    if (!m) return setSel(null);
    const [, id, vi, startStr] = m;
    const at = Number(startStr);
    const part = score.parts.find((p) => p.id === id);
    const hit = part && placedNotes(part.voices[Number(vi)]).find((n) => at >= n.start && at < n.start + n.duration);
    if (hit) {
      setSel({ partId: id, voice: Number(vi), start: hit.start });
      setPartId(id);
    }
  }

  async function onPlay() {
    if (playing) { stop(); setPlaying(false); return; }
    try {
      setLoading(true);
      await play(score, () => setPlaying(false));
      setPlaying(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setHist((h) => (e.shiftKey ? redo(h) : undo(h)));
        setSel(null);
        setCursor(null);
      } else if (e.key === "Delete" || e.key === "Backspace") del();
      else if (e.key === "ArrowUp") { e.preventDefault(); nudge(e.shiftKey ? 12 : 1); }
      else if (e.key === "ArrowDown") { e.preventDefault(); nudge(e.shiftKey ? -12 : -1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const activeIndex = score.parts.findIndex((p) => p.id === partId);

  return (
    <main>
      <h1>{score.title}</h1>
      <div className="bar">
        <button className="primary" onClick={onPlay} disabled={loading}>
          {loading ? "Loading piano…" : playing ? "Stop" : "Play"}
        </button>
        <button onClick={() => { setHist((h) => undo(h)); setSel(null); setCursor(null); }} disabled={!hist.past.length}>Undo</button>
        <button onClick={() => { setHist((h) => redo(h)); setSel(null); setCursor(null); }} disabled={!hist.future.length}>Redo</button>
        <span className="seg">
          <button aria-pressed={view === "staff"} onClick={() => setView("staff")}>Staff</button>
          <button aria-pressed={view === "roll"} onClick={() => setView("roll")}>Roll</button>
        </span>
        <span className="muted">{score.bpm} bpm · {score.timeSig.beats}/{score.timeSig.beatType}</span>
      </div>

      <div className="bar">
        {score.parts.map((p, i) => (
          <button key={p.id} aria-pressed={p.id === partId} onClick={() => { setPartId(p.id); setCursor(null); }}
            style={{ borderColor: PART_COLORS[i % PART_COLORS.length] }}>
            {p.name}
          </button>
        ))}
        <button onClick={() => addStaff("treble")}>+ Treble</button>
        <button onClick={() => addStaff("bass")}>+ Bass</button>
      </div>

      {error && <p role="alert">{error}</p>}

      {view === "staff" ? (
        <div className="score" ref={staffBox} onClick={onStaffClick} dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <>
          <div ref={staffBox} hidden />
          <PianoRoll
            score={score}
            selected={sel}
            activePartId={partId}
            duration={duration}
            measure={measure}
            onAdd={(id, start, pitch) => addAt(id, start, pitch)}
            onSelect={(s) => { setSel(s); if (s) setPartId(s.partId); }}
            onMove={(s, start, dp) =>
              edit((sc) => mapVoice(sc, s.partId, s.voice, (v) => {
                const n = placedNotes(v).find((x) => x.start === s.start)!;
                return updateNoteAt(v, s.start, { start, pitches: n.pitches.map((p) => p + dp) });
              }))
            }
            onResize={(s, d) => edit((sc) => mapVoice(sc, s.partId, s.voice, (v) => updateNoteAt(v, s.start, { duration: d })))}
          />
        </>
      )}

      <div className="bar tools">
        <span className="muted">Length</span>
        {DURATIONS.map(([d, label]) => (
          <button key={d} aria-pressed={d === duration} onClick={() => setDur(d)} aria-label={`${d} sixteenths`}>{label}</button>
        ))}
        <button onClick={addRest} title="Skip entry cursor by one duration">Rest</button>
      </div>

      <div className="bar tools">
        <span className="muted">{selNote ? "Selected" : "Select a note"}</span>
        <button disabled={!selNote} onClick={() => nudge(1)}>♯ ↑</button>
        <button disabled={!selNote} onClick={() => nudge(-1)}>♭ ↓</button>
        <button disabled={!selNote} onClick={() => nudge(12)}>8va ↑</button>
        <button disabled={!selNote} onClick={() => nudge(-12)}>8va ↓</button>
        <button disabled={!selNote} onClick={del}>Delete</button>
      </div>

      <Keyboard onKey={stepEnter} />
      <p className="muted">
        Keys add notes to <b style={{ color: PART_COLORS[Math.max(0, activeIndex) % PART_COLORS.length] }}>{score.parts[activeIndex]?.name}</b> at the cursor.
        Roll: tap empty cell to add, drag note to move, drag its right edge to resize. ⌘Z undo, arrows nudge pitch.
      </p>
    </main>
  );
}
