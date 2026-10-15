import { useEffect, useMemo, useRef, useState } from "react";
import { toMusicXML } from "@composer/core";
import { demoScore } from "./demo";
import { renderMusicXML } from "./render";
import { play, stop } from "./audio";

export function App() {
  const score = demoScore;
  const xml = useMemo(() => toMusicXML(score), [score]);
  const box = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState("");
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const width = box.current?.clientWidth ?? 800;
    renderMusicXML(xml, width).then(setSvg, (e) => setError(String(e)));
  }, [xml]);

  async function onPlay() {
    if (playing) {
      stop();
      setPlaying(false);
      return;
    }
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

  return (
    <main>
      <h1>{score.title}</h1>
      <div className="bar">
        <button className="primary" onClick={onPlay} disabled={loading}>
          {loading ? "Loading piano…" : playing ? "Stop" : "Play"}
        </button>
        <span className="muted">
          {score.bpm} bpm · {score.timeSig.beats}/{score.timeSig.beatType} · {score.parts.length} staves
        </span>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="score" ref={box} dangerouslySetInnerHTML={{ __html: svg }} />
    </main>
  );
}
