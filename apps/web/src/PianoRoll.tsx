import { useEffect, useMemo, useRef, useState } from "react";
import { placedNotes, scoreLength, type Score } from "@composer/core";

export interface Sel {
  partId: string;
  voice: number;
  start: number;
}

export const PART_COLORS = ["#b4491f", "#2f6f8f", "#6b8e23", "#8a4fa0", "#c08a00", "#b03060"];

const CELL_W = 22;
const ROW_H = 16;
const BLACK = new Set([1, 3, 6, 8, 10]);
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

interface Props {
  score: Score;
  selected: Sel | null;
  activePartId: string;
  duration: number;
  measure: number;
  onAdd: (partId: string, start: number, pitch: number) => void;
  onSelect: (s: Sel | null) => void;
  onMove: (s: Sel, newStart: number, pitchDelta: number) => void;
  onResize: (s: Sel, newDuration: number) => void;
}

type Drag =
  | { kind: "move"; sel: Sel; grabCol: number; grabRow: number; origStart: number; dCol: number; dRow: number }
  | { kind: "resize"; sel: Sel; origStart: number; dur: number };

export function PianoRoll(p: Props) {
  const { score } = p;
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const { lo, hi, cols } = useMemo(() => {
    const all = score.parts.flatMap((pt) => pt.voices.flatMap((v) => placedNotes(v).flatMap((n) => n.pitches)));
    // fixed C2-C7 so the grid never shifts under the pointer while editing
    const min = Math.min(36, ...all);
    const max = Math.max(96, ...all);
    const total = Math.ceil((scoreLength(score) + p.measure) / p.measure) * p.measure;
    return { lo: min, hi: max, cols: Math.max(total, p.measure * 4) };
  }, [score, p.measure]);

  const rows = hi - lo + 1;

  // start scrolled to where the music is
  useEffect(() => {
    const all = score.parts.flatMap((pt) => pt.voices.flatMap((v) => placedNotes(v).flatMap((n) => n.pitches)));
    const top = all.length ? Math.max(...all) : 76;
    if (wrap.current) wrap.current.scrollTop = Math.max(0, (hi - top - 3) * ROW_H);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const width = cols * CELL_W;
  const height = rows * ROW_H;
  const yOf = (pitch: number) => (hi - pitch) * ROW_H;

  function cell(e: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect();
    return {
      col: Math.floor((e.clientX - r.left) / CELL_W),
      row: Math.floor((e.clientY - r.top) / ROW_H),
      fx: ((e.clientX - r.left) / CELL_W) % 1,
    };
  }

  function hitNote(col: number, pitch: number) {
    for (const pt of score.parts) {
      for (let vi = 0; vi < pt.voices.length; vi++) {
        for (const n of placedNotes(pt.voices[vi])) {
          if (col >= n.start && col < n.start + n.duration && n.pitches.includes(pitch)) {
            return { sel: { partId: pt.id, voice: vi, start: n.start } as Sel, note: n };
          }
        }
      }
    }
    return null;
  }

  function onDown(e: React.PointerEvent) {
    const { col, row } = cell(e);
    const pitch = hi - row;
    const hit = hitNote(col, pitch);
    if (!hit) {
      p.onSelect(null);
      p.onAdd(p.activePartId, col, pitch);
      return;
    }
    p.onSelect(hit.sel);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const endCol = hit.note.start + hit.note.duration;
    if (col === endCol - 1 && hit.note.duration > 1 && cell(e).fx > 0.5) {
      setDrag({ kind: "resize", sel: hit.sel, origStart: hit.note.start, dur: hit.note.duration });
    } else {
      setDrag({ kind: "move", sel: hit.sel, grabCol: col, grabRow: row, origStart: hit.note.start, dCol: 0, dRow: 0 });
    }
  }

  function onMovePtr(e: React.PointerEvent) {
    if (!drag) return;
    const { col, row } = cell(e);
    if (drag.kind === "move") {
      setDrag({ ...drag, dCol: col - drag.grabCol, dRow: row - drag.grabRow });
    } else {
      setDrag({ ...drag, dur: Math.max(1, col - drag.origStart + 1) });
    }
  }

  function onUp() {
    if (!drag) return;
    if (drag.kind === "move") {
      if (drag.dCol !== 0 || drag.dRow !== 0) {
        p.onMove(drag.sel, Math.max(0, drag.origStart + drag.dCol), -drag.dRow);
      }
    } else {
      p.onResize(drag.sel, drag.dur);
    }
    setDrag(null);
  }

  return (
    <div className="roll" ref={wrap}>
      <svg
        ref={ref}
        width={width}
        height={height}
        onPointerDown={onDown}
        onPointerMove={onMovePtr}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
        style={{ touchAction: "pan-x pan-y", display: "block" }}
        role="img"
        aria-label="Piano roll"
      >
        {Array.from({ length: rows }, (_, i) => {
          const pitch = hi - i;
          const pc = ((pitch % 12) + 12) % 12;
          return (
            <g key={pitch}>
              <rect x={0} y={i * ROW_H} width={width} height={ROW_H} fill={BLACK.has(pc) ? "var(--roll-black)" : "var(--roll-white)"} />
              {pc === 0 && (
                <text x={4} y={i * ROW_H + 12} fontSize={10} fill="var(--muted)">
                  {NAMES[pc]}{Math.floor(pitch / 12) - 1}
                </text>
              )}
            </g>
          );
        })}
        {Array.from({ length: cols + 1 }, (_, c) => (
          <line
            key={c}
            x1={c * CELL_W}
            x2={c * CELL_W}
            y1={0}
            y2={height}
            stroke="var(--line)"
            strokeWidth={c % p.measure === 0 ? 1.5 : c % 4 === 0 ? 1 : 0.4}
            opacity={c % 4 === 0 ? 1 : 0.5}
          />
        ))}
        {score.parts.map((pt, pi) =>
          pt.voices.flatMap((v, vi) =>
            placedNotes(v).flatMap((n) => {
              const isSel = p.selected?.partId === pt.id && p.selected.voice === vi && p.selected.start === n.start;
              let start = n.start;
              let dur = n.duration;
              let dPitch = 0;
              if (drag && isSel) {
                if (drag.kind === "move") {
                  start = Math.max(0, drag.origStart + drag.dCol);
                  dPitch = -drag.dRow;
                } else dur = drag.dur;
              }
              return n.pitches.map((pitch) => (
                <rect
                  key={`${pt.id}-${vi}-${n.start}-${pitch}`}
                  x={start * CELL_W + 1}
                  y={yOf(pitch + dPitch) + 1}
                  width={dur * CELL_W - 2}
                  height={ROW_H - 2}
                  rx={3}
                  fill={PART_COLORS[pi % PART_COLORS.length]}
                  opacity={pt.id === p.activePartId ? 1 : 0.55}
                  stroke={isSel ? "var(--fg)" : "none"}
                  strokeWidth={2}
                />
              ));
            }),
          ),
        )}
      </svg>
    </div>
  );
}
