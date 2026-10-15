import { useEffect, useMemo, useRef, useState } from "react";
import {
  commit, createHistory, entryCursor, insertNote, mapVoice, measureLength, placedNotes,
  appendCandidate, redo, removeNoteAt, sectionStart, toMusicXML, undo, updateNoteAt, voiceFromPlacedNotes,
  type Candidate, type ExpandMode, type ExpandRequest, type History, type Score,
} from "@composer/core";
import { demoScore } from "./demo";
import { renderMusicXML } from "./render";
import { play, preview, stop } from "./audio";
import { PianoRoll, PART_COLORS, type Sel } from "./PianoRoll";
import { Keyboard } from "./Keyboard";
import { CapturePanel, type ApplyTake } from "./CapturePanel";
import { HarmonyPanel, type ApplyHarmony } from "./HarmonyPanel";
import { ExpandPanel, type GhostNotes } from "./ExpandPanel";
import { OrchestratePanel, type ApplyOrchestra } from "./OrchestratePanel";

const blankScore: Score = {
  title: "Untitled",
  bpm: 100,
  timeSig: { beats: 4, beatType: 4 },
  keyFifths: 0,
  parts: [{ id: "P1", name: "Melody", instrument: { program: 0, clef: "treble" }, voices: [{ events: [] }] }],
};

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
  const [ghost, setGhost] = useState<GhostNotes | null>(null);
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

  function applyTake(a: ApplyTake) {
    const id = `P${score.parts.length + 1}`;
    edit((s) => {
      const base = a.keyFifths != null ? { ...s, keyFifths: a.keyFifths, mode: a.keyMode ?? s.mode } : s;
      if (a.mode === "new") {
        return {
          ...base,
          parts: [...base.parts, { id, name: `Take ${base.parts.length + 1}`, instrument: { program: 0, clef: a.clef }, voices: [a.voice] }],
        };
      }
      return mapVoice(base, partId, 0, () => a.voice);
    });
    if (a.mode === "new") setPartId(id);
    setSel(null);
    setCursor(null);
  }

  function applyHarmony(a: ApplyHarmony) {
    edit((s) => ({
      ...s,
      mode: a.mode,
      chords: a.spans.map((x) => ({ start: x.start, root: x.chord.root, quality: x.chord.quality })),
      parts: [
        ...s.parts.filter((p) => p.id !== "harmony"),
        { id: "harmony", name: "Harmony", instrument: { program: 0, clef: "bass" as const }, voices: [a.voice] },
      ],
    }));
    setSel(null);
  }

  function applyOrchestra(a: ApplyOrchestra) {
    edit((s) => ({ ...s, parts: [...s.parts.filter((p) => !p.id.startsWith("orch-")), ...a.parts] }));
    setSel(null);
  }

  function removeOrchestra() {
    edit((s) => ({ ...s, parts: s.parts.filter((p) => !p.id.startsWith("orch-")) }));
    if (partId.startsWith("orch-")) setPartId(score.parts[0].id);
    setSel(null);
  }

  function removeHarmony() {
    edit((s) => ({ ...s, chords: undefined, parts: s.parts.filter((p) => p.id !== "harmony") }));
    if (partId === "harmony") setPartId(score.parts[0].id);
    setSel(null);
  }

  function acceptCandidate(c: Candidate, mode: ExpandMode) {
    const src = score.parts.find((p) => p.id === partId)!;
    if (mode === "vary") {
      const id = `P${score.parts.length + 1}`;
      edit((s) => ({
        ...s,
        parts: [...s.parts, { id, name: `${src.name} (variation)`, instrument: src.instrument, voices: [voiceFromPlacedNotes(c.notes)] }],
      }));
      setPartId(id);
    } else {
      const req = { melody: src.voices[0], timeSig: score.timeSig } as ExpandRequest;
      edit((s) => mapVoice(s, partId, 0, (v) => appendCandidate(v, c, sectionStart({ ...req, melody: v }))));
    }
    setSel(null);
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

  const activeIndex = Math.max(0, score.parts.findIndex((p) => p.id === partId));

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
        <button onClick={() => { setHist(createHistory(blankScore)); setPartId("P1"); setSel(null); setCursor(null); }}>New</button>
      </div>

      <CapturePanel
        score={score}
        activeName={score.parts[activeIndex]?.name ?? ""}
        onTempo={(bpm) => edit((s) => ({ ...s, bpm }))}
        onMeter={(beats, beatType) => edit((s) => ({ ...s, timeSig: { beats, beatType } }))}
        onApply={applyTake}
      />

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

      {partId !== "harmony" && (
        <HarmonyPanel
          score={score}
          melody={voiceOf(partId)}
          melodyName={score.parts[activeIndex]?.name ?? ""}
          hasHarmony={score.parts.some((p) => p.id === "harmony")}
          onApply={applyHarmony}
          onRemove={removeHarmony}
        />
      )}

      {!partId.startsWith("orch-") && partId !== "harmony" && score.parts[activeIndex] && (
        <OrchestratePanel
          score={score}
          source={score.parts[activeIndex]}
          hasArrangement={score.parts.some((p) => p.id.startsWith("orch-"))}
          onApply={applyOrchestra}
          onRemove={removeOrchestra}
        />
      )}

      {partId !== "harmony" && score.parts[activeIndex] && (
        <ExpandPanel score={score} part={score.parts[activeIndex]} onGhost={setGhost} onAccept={acceptCandidate} />
      )}
      {ghost && view === "staff" && <p className="muted">Showing a candidate outline in Roll view. <button onClick={() => setView("roll")}>Show in Roll</button></p>}

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
            ghost={ghost?.partId === partId ? ghost.notes : undefined}
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
