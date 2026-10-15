import { useState } from "react";

const WHITE = [0, 2, 4, 5, 7, 9, 11, 12];
const BLACK_AT: Record<number, number> = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };

export function Keyboard({ onKey }: { onKey: (midi: number) => void }) {
  const [oct, setOct] = useState(4);
  const base = 12 * (oct + 1);
  const keyW = 100 / WHITE.length;
  return (
    <div className="kbd">
      <div className="kbd-keys">
        {WHITE.map((s, i) => (
          <button key={s} className="white" style={{ left: `${i * keyW}%`, width: `${keyW}%` }}
            onPointerDown={(e) => { e.preventDefault(); onKey(base + s); }} aria-label={`note ${base + s}`} />
        ))}
        {Object.entries(BLACK_AT).map(([semi, idx]) => (
          <button key={semi} className="black" style={{ left: `${(idx + 1) * keyW - keyW * 0.3}%`, width: `${keyW * 0.6}%` }}
            onPointerDown={(e) => { e.preventDefault(); onKey(base + Number(semi)); }} aria-label={`note ${base + Number(semi)}`} />
        ))}
      </div>
      <div className="kbd-oct">
        <button onClick={() => setOct((o) => Math.max(1, o - 1))} aria-label="octave down">−</button>
        <span className="muted">C{oct}</span>
        <button onClick={() => setOct((o) => Math.min(7, o + 1))} aria-label="octave up">+</button>
      </div>
    </div>
  );
}
