import { useMemo, useState } from "react";
import {
  ENSEMBLES, INSTRUMENTS, ROLES, barsOf, buildPlanPrompt, chordName, defaultPlan, detectMode, harmonize,
  parsePlan, placedNotes, PLAN_SYSTEM, realize, tonicOf, rootName,
  type ArrangementPlan, type ChordSpan, type EnsembleId, type Part, type Role, type Score,
} from "@composer/core";
import { proxyComplete } from "./generator";

export interface ApplyOrchestra {
  parts: Part[];
}

interface Props {
  score: Score;
  source: Part;
  hasArrangement: boolean;
  onApply: (a: ApplyOrchestra) => void;
  onRemove: () => void;
}

const ROLE_LABEL: Record<Role, string> = {
  melody: "Melody", double: "Doubles", counter: "Counter", pad: "Pad", rhythm: "Pulse", bass: "Bass", tacet: "—",
};

function chordsFrom(score: Score, melodyBars: number): ChordSpan[] | null {
  if (!score.chords?.length) return null;
  const sorted = [...score.chords].sort((a, b) => a.start - b.start);
  const end = melodyBars * 16;
  return sorted.map((c, i) => ({
    start: c.start,
    duration: (sorted[i + 1]?.start ?? end) - c.start,
    chord: { root: c.root, quality: c.quality, numeral: "" },
  }));
}

export function OrchestratePanel({ score, source, hasArrangement, onApply, onRemove }: Props) {
  const melody = source.voices[0];
  const notes = useMemo(() => placedNotes(melody), [melody]);
  const bars = barsOf(melody, score.timeSig);
  const [ens, setEns] = useState<EnsembleId>("orchestra");
  const instruments = ENSEMBLES[ens].instruments;

  const mode = score.mode ?? detectMode(notes.map((n) => ({ pitch: n.pitches[0], durationBeats: n.duration / 4 })), score.keyFifths) ?? "major";
  const chords = useMemo(
    () => chordsFrom(score, bars) ?? (notes.length ? harmonize(melody, { keyFifths: score.keyFifths, mode, timeSig: score.timeSig }) : []),
    [score.chords, score.keyFifths, score.timeSig, melody, notes.length, mode, bars],
  );

  const [plan, setPlan] = useState<ArrangementPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [source_, setSource] = useState<"rules" | "claude">("rules");

  // a plan only belongs to the ensemble and bar count it was made for
  const current = plan && plan.ensemble.join() === instruments.join() && plan.sections.reduce((s, x) => s + x.bars, 0) === bars ? plan : null;

  function makeRulesPlan() {
    setError("");
    setSource("rules");
    setPlan(defaultPlan(bars, instruments));
  }

  async function askClaude() {
    setBusy(true);
    setError("");
    try {
      const ps = notes.map((n) => n.pitches[0]);
      const tonic = tonicOf(score.keyFifths, mode);
      const prompt = buildPlanPrompt({
        bars, ensemble: instruments, timeSig: score.timeSig,
        keyName: `${rootName(tonic, score.keyFifths)} ${mode}`,
        chordNames: Array.from({ length: bars }, (_, b) => {
          const c = chords.find((s) => s.start <= b * 16 && b * 16 < s.start + s.duration);
          return c ? chordName(c.chord, score.keyFifths) : "?";
        }),
        melodyRange: [Math.min(...ps), Math.max(...ps)],
      });
      const text = await proxyComplete(PLAN_SYSTEM, prompt);
      setPlan(parsePlan(text, bars, instruments));
      setSource("claude");
    } catch (e) {
      setError(`${(e as Error).message} Using the rule-based plan instead.`);
      setPlan(defaultPlan(bars, instruments));
      setSource("rules");
    } finally {
      setBusy(false);
    }
  }

  function setRole(sec: number, id: string, role: Role) {
    if (!current) return;
    setPlan({
      ...current,
      sections: current.sections.map((s, i) => (i === sec ? { ...s, roles: { ...s.roles, [id]: role } } : s)),
    });
  }

  function apply() {
    if (!current) return;
    onApply({ parts: realize(melody, chords, current, score.timeSig) });
  }

  let barAt = 1;
  return (
    <section className="capture" aria-label="Orchestrate">
      <div className="bar">
        <label className="field">
          Ensemble
          <select value={ens} onChange={(e) => { setEns(e.target.value as EnsembleId); setPlan(null); }}>
            {(Object.keys(ENSEMBLES) as EnsembleId[]).map((k) => <option key={k} value={k}>{ENSEMBLES[k].name}</option>)}
          </select>
        </label>
        <button disabled={!notes.length || busy} onClick={makeRulesPlan}>Quick plan</button>
        <button disabled={!notes.length || busy} onClick={askClaude}>{busy ? "Planning…" : "Ask Claude to plan"}</button>
        {hasArrangement && <button onClick={onRemove}>Remove</button>}
      </div>
      <p className="muted prog">
        {notes.length
          ? <>Arranges “{source.name}” ({bars} bars) for {ENSEMBLES[ens].name.toLowerCase()}. {current ? `Plan by ${source_ === "claude" ? "Claude" : "rules"}: edit any cell, then build.` : "Make a plan first."}</>
          : <>Pick a staff with a melody to orchestrate.</>}
      </p>
      {error && <p role="alert" className="err">{error}</p>}

      {current && (
        <>
          <div className="plan">
            <table>
              <thead>
                <tr>
                  <th />
                  {current.sections.map((s, i) => {
                    const from = barAt;
                    barAt += s.bars;
                    return (
                      <th key={i}>
                        {s.name}
                        <small>bars {from}–{barAt - 1}{s.dynamics ? ` · ${s.dynamics}` : ""}</small>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {instruments.map((id) => (
                  <tr key={id}>
                    <th scope="row">{INSTRUMENTS[id].name}</th>
                    {current.sections.map((s, i) => (
                      <td key={i}>
                        <select value={s.roles[id] ?? "tacet"} onChange={(e) => setRole(i, id, e.target.value as Role)}
                          className={`role role-${s.roles[id] ?? "tacet"}`} aria-label={`${INSTRUMENTS[id].name}, ${s.name}`}>
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bar">
            <button className="primary" onClick={apply}>{hasArrangement ? "Rebuild score" : "Build score"}</button>
          </div>
        </>
      )}
    </section>
  );
}
