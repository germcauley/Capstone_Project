import {
  DIVISIONS_PER_QUARTER,
  measureLength,
  type Score,
  type ScoreEvent,
  type Voice,
} from "./score.js";

const SHARP_NAMES = [["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0], ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0]] as const;
const FLAT_NAMES = [["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0], ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0]] as const;

export function spellPitch(midi: number, keyFifths: number) {
  const table = keyFifths < 0 ? FLAT_NAMES : SHARP_NAMES;
  const [step, alter] = table[((midi % 12) + 12) % 12];
  return { step, alter, octave: Math.floor(midi / 12) - 1 };
}

/** Notatable durations in 16ths, largest first. */
const TYPES: [number, string, boolean][] = [
  [16, "whole", false],
  [12, "half", true],
  [8, "half", false],
  [6, "quarter", true],
  [4, "quarter", false],
  [3, "eighth", true],
  [2, "eighth", false],
  [1, "16th", false],
];

/** Split a length into notatable pieces, aligned so pieces never cross a beat awkwardly. */
function splitDuration(len: number): number[] {
  const parts: number[] = [];
  let left = len;
  while (left > 0) {
    const [d] = TYPES.find(([d]) => d <= left)!;
    parts.push(d);
    left -= d;
  }
  return parts;
}

interface Piece {
  /** absolute start in sixteenths within the voice */
  start: number;
  pitches: number[] | null;
  duration: number;
  tieStart: boolean;
  tieStop: boolean;
}

/** Cut events at barlines and into notatable lengths, adding ties. */
function toMeasures(voice: Voice, mLen: number): Piece[][] {
  const measures: Piece[][] = [[]];
  let room = mLen;
  let abs = 0;
  const push = (p: Omit<Piece, "start">) => {
    measures[measures.length - 1].push({ ...p, start: abs });
    abs += p.duration;
    room -= p.duration;
    if (room === 0) {
      measures.push([]);
      room = mLen;
    }
  };
  for (const ev of voice.events as ScoreEvent[]) {
    let left = ev.duration;
    const isNote = ev.kind === "note";
    let first = true;
    while (left > 0) {
      const chunk = Math.min(left, room);
      const pieces = splitDuration(chunk);
      pieces.forEach((d, i) => {
        const last = left - chunk === 0 && i === pieces.length - 1;
        push({
          pitches: isNote ? ev.pitches : null,
          duration: d,
          tieStop: isNote && !(first && i === 0),
          tieStart: isNote && (!last || !!ev.tieToNext),
        });
      });
      first = false;
      left -= chunk;
    }
  }
  if (measures[measures.length - 1].length === 0) measures.pop();
  else {
    // pad final bar with rests
    const used = mLen - room;
    if (used < mLen) {
      for (const d of splitDuration(mLen - used)) {
        push({ pitches: null, duration: d, tieStart: false, tieStop: false });
      }
    }
  }
  if (measures.length > 1 && measures[measures.length - 1].length === 0) measures.pop();
  return measures;
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function toMusicXML(score: Score): string {
  const mLen = measureLength(score.timeSig);
  const parts = score.parts.map((p, pi) => {
    const voiceMeasures = p.voices.map((v) => toMeasures(v, mLen));
    const nMeasures = Math.max(1, ...voiceMeasures.map((m) => m.length));
    const clef = p.instrument.clef === "bass" ? ["F", 4] : ["G", 2];
    let xml = `<part id="${esc(p.id)}">\n`;
    for (let m = 0; m < nMeasures; m++) {
      xml += `<measure number="${m + 1}">\n`;
      if (m === 0) {
        xml += `<attributes><divisions>${DIVISIONS_PER_QUARTER}</divisions>` +
          `<key><fifths>${score.keyFifths}</fifths></key>` +
          `<time><beats>${score.timeSig.beats}</beats><beat-type>${score.timeSig.beatType}</beat-type></time>` +
          `<clef><sign>${clef[0]}</sign><line>${clef[1]}</line></clef></attributes>\n`;
        if (pi === 0) {
          xml += `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.bpm}</per-minute></metronome></direction-type><sound tempo="${score.bpm}"/></direction>\n`;
        }
      }
      voiceMeasures.forEach((vm, vi) => {
        if (vi > 0) xml += `<backup><duration>${mLen}</duration></backup>\n`;
        const pieces = vm[m] ?? [{ start: m * mLen, pitches: null, duration: mLen, tieStart: false, tieStop: false }];
        for (const pc of pieces) {
          const type = TYPES.find(([d]) => d === pc.duration)!;
          const dot = type[2] ? "<dot/>" : "";
          if (!pc.pitches) {
            xml += `<note><rest/><duration>${pc.duration}</duration><voice>${vi + 1}</voice><type>${type[1]}</type>${dot}</note>\n`;
            continue;
          }
          pc.pitches.forEach((midi, ci) => {
            const s = spellPitch(midi, score.keyFifths);
            xml += `<note id="n-${esc(p.id)}-${vi}-${pc.start}-c${ci}">${ci > 0 ? "<chord/>" : ""}<pitch><step>${s.step}</step>` +
              (s.alter ? `<alter>${s.alter}</alter>` : "") +
              `<octave>${s.octave}</octave></pitch><duration>${pc.duration}</duration>` +
              (pc.tieStop ? `<tie type="stop"/>` : "") +
              (pc.tieStart ? `<tie type="start"/>` : "") +
              `<voice>${vi + 1}</voice><type>${type[1]}</type>${dot}` +
              (pc.tieStop || pc.tieStart
                ? `<notations>${pc.tieStop ? `<tied type="stop"/>` : ""}${pc.tieStart ? `<tied type="start"/>` : ""}</notations>`
                : "") +
              `</note>\n`;
          });
        }
      });
      xml += `</measure>\n`;
    }
    return xml + `</part>\n`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
<work><work-title>${esc(score.title)}</work-title></work>
<part-list>
${score.parts.map((p) => `<score-part id="${esc(p.id)}"><part-name>${esc(p.name)}</part-name></score-part>`).join("\n")}
</part-list>
${parts.join("")}</score-partwise>
`;
}
