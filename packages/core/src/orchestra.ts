import { placedNotes, voiceFromPlacedNotes, type Placed } from "./edit.js";
import { chordTones, type ChordSpan } from "./harmony.js";
import { INSTRUMENTS, type InstrumentDef } from "./instruments.js";
import { parseModelJson } from "./expand.js";
import { measureLength, voiceLength, type Part, type Score, type Voice } from "./score.js";

export type Role = "melody" | "double" | "counter" | "pad" | "rhythm" | "bass" | "tacet";
export const ROLES: Role[] = ["melody", "double", "counter", "pad", "rhythm", "bass", "tacet"];

export interface PlanSection {
  name: string;
  bars: number;
  dynamics?: string;
  texture?: string;
  /** instrument id -> role */
  roles: Record<string, Role>;
}

export interface ArrangementPlan {
  ensemble: string[];
  sections: PlanSection[];
}

const isRole = (r: unknown): r is Role => typeof r === "string" && (ROLES as string[]).includes(r);

// ---------- rule-based plan ----------

const first = (ids: string[], have: Set<string>) => ids.find((i) => have.has(i));

function sectionRoles(level: 0 | 1 | 2, ens: string[]): Record<string, Role> {
  const have = new Set(ens);
  const r: Record<string, Role> = Object.fromEntries(ens.map((i) => [i, "tacet" as Role]));
  const set = (id: string, role: Role) => have.has(id) && (r[id] = role);

  const lead = first(["vn1", "fl", "cl", "ob", "vc"], have)!;
  r[lead] = "melody";

  // strings always form the bed
  set("vc", "bass");
  set("cb", "bass");
  set("va", level === 0 ? "pad" : "rhythm");
  set("vn2", level === 2 ? "counter" : "pad");
  if (lead !== "vn1" && have.has("vn1")) set("vn1", "pad");
  if (!have.has("vc") && !have.has("cb")) {
    const low = first(["bsn", "tbn", "tuba", "va"], have);
    if (low && low !== lead) r[low] = "bass";
  }

  if (level >= 1) {
    set("fl", lead === "fl" ? "melody" : "double");
    set("cl", "pad");
    set("ob", level === 2 ? "double" : "counter");
    set("bsn", "bass");
    set("hn", "pad");
  }
  if (level === 2) {
    set("tpt", "double");
    set("tbn", "pad");
    set("tuba", "bass");
    set("hn", "pad");
  }
  return r;
}

const DYN = ["p", "mf", "f"];
const TEXTURE = ["strings, sparse", "adding winds", "full ensemble"];

export function defaultPlan(bars: number, ensemble: string[]): ArrangementPlan {
  const chunk = bars <= 4 ? 2 : 4;
  const sizes: number[] = [];
  let left = Math.max(1, bars);
  while (left > 0) {
    const take = left - chunk < chunk / 2 ? left : chunk; // fold a tiny tail into the last section
    sizes.push(Math.min(take, left));
    left -= Math.min(take, left);
  }
  const n = sizes.length;
  const sections: PlanSection[] = sizes.map((b, i) => {
    const level = (n === 1 ? 2 : i === 0 ? 0 : i === n - 1 ? 2 : 1) as 0 | 1 | 2;
    return {
      name: n === 1 ? "Theme" : i === 0 ? "Statement" : i === n - 1 ? "Climax" : `Development ${i}`,
      bars: b,
      dynamics: DYN[level],
      texture: TEXTURE[level],
      roles: sectionRoles(level, ensemble),
    };
  });
  return { ensemble, sections };
}

// ---------- LLM plan ----------

export const PLAN_SYSTEM =
  "You are an orchestrator inside a music notation app. Reply with ONE JSON object only: no prose, no markdown.";

export function buildPlanPrompt(opts: {
  bars: number;
  ensemble: string[];
  keyName: string;
  chordNames?: string[];
  melodyRange: [number, number];
  timeSig: Score["timeSig"];
}): string {
  const inst = opts.ensemble
    .map((id) => `${id} = ${INSTRUMENTS[id].name} (${INSTRUMENTS[id].family}, MIDI ${INSTRUMENTS[id].lo}-${INSTRUMENTS[id].hi})`)
    .join("\n");
  return [
    `Plan an orchestral arrangement of a ${opts.bars}-bar melody in ${opts.keyName}, ${opts.timeSig.beats}/${opts.timeSig.beatType}.`,
    opts.chordNames?.length ? `Harmony per bar: ${opts.chordNames.join(" | ")}` : "",
    `Melody range: MIDI ${opts.melodyRange[0]}-${opts.melodyRange[1]}.`,
    ``,
    `Instruments available:`,
    inst,
    ``,
    `Roles: melody (plays the tune), double (doubles the tune), counter (countermelody), pad (sustained harmony), rhythm (repeated chord pulse), bass (bass line), tacet (silent).`,
    `Split the melody into 2-5 consecutive sections whose "bars" add up to exactly ${opts.bars}.`,
    `Shape the whole like a piece: begin lighter, build, and use the full ensemble where it peaks. Give each section a role for EVERY instrument. Each section needs at least one melody.`,
    ``,
    `Reply with exactly this shape:`,
    `{"sections":[{"name":"Statement","bars":4,"dynamics":"p","texture":"strings only","roles":{"vn1":"melody","vc":"bass","vn2":"pad"}}]}`,
  ].filter(Boolean).join("\n");
}

/** Validate a model plan against the ensemble and bar count; fill gaps from the rule-based plan. */
export function normalizePlan(raw: unknown, bars: number, ensemble: string[]): ArrangementPlan {
  const fallback = defaultPlan(bars, ensemble);
  const list = (raw as { sections?: unknown })?.sections;
  if (!Array.isArray(list) || !list.length) return fallback;

  const sections: PlanSection[] = [];
  let used = 0;
  for (const s of list as Record<string, unknown>[]) {
    if (used >= bars) break;
    const want = Math.max(1, Math.round(Number(s.bars) || 0));
    const b = Math.min(want, bars - used);
    const rolesIn = (s.roles && typeof s.roles === "object" ? s.roles : {}) as Record<string, unknown>;
    const roles: Record<string, Role> = {};
    for (const id of ensemble) roles[id] = isRole(rolesIn[id]) ? (rolesIn[id] as Role) : "tacet";
    if (!Object.values(roles).includes("melody")) {
      const lead = first(["vn1", "fl", "cl", "ob", "vc"], new Set(ensemble)) ?? ensemble[0];
      roles[lead] = "melody";
    }
    sections.push({
      name: typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 30) : `Section ${sections.length + 1}`,
      bars: b,
      dynamics: typeof s.dynamics === "string" ? s.dynamics.slice(0, 8) : undefined,
      texture: typeof s.texture === "string" ? s.texture.slice(0, 60) : undefined,
      roles,
    });
    used += b;
  }
  if (used < bars) sections[sections.length - 1].bars += bars - used;
  return { ensemble, sections };
}

export function parsePlan(text: string, bars: number, ensemble: string[]): ArrangementPlan {
  return normalizePlan(parseModelJson(text), bars, ensemble);
}

// ---------- realization ----------

/** Octave shift (multiple of 12) that puts the most notes inside the range; ties prefer smaller shifts. */
function bestShift(pitches: number[], inst: InstrumentDef): number {
  let best = 0;
  let bestOut = Infinity;
  for (const shift of [0, 12, -12, 24, -24, 36, -36]) {
    const out = pitches.filter((p) => p + shift < inst.lo || p + shift > inst.hi).length;
    if (out < bestOut) { bestOut = out; best = shift; }
  }
  return best;
}

export function fitToRange(p: number, inst: InstrumentDef): number {
  let m = p;
  while (m < inst.lo) m += 12;
  while (m > inst.hi) m -= 12;
  return Math.min(inst.hi, Math.max(inst.lo, m));
}

function nearestPc(pc: number, target: number, inst: InstrumentDef): number {
  let best = fitToRange(inst.lo + ((pc - inst.lo) % 12 + 12) % 12, inst);
  let bestD = Infinity;
  for (let m = inst.lo; m <= inst.hi; m++) {
    if (m % 12 !== pc) continue;
    const d = Math.abs(m - target);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

const centre = (i: InstrumentDef) => Math.round((i.lo + i.hi) / 2);

interface Window { start: number; end: number }

function spansIn(spans: ChordSpan[], w: Window): { start: number; end: number; tones: number[]; root: number }[] {
  const out: { start: number; end: number; tones: number[]; root: number }[] = [];
  for (const s of spans) {
    const a = Math.max(w.start, s.start);
    const b = Math.min(w.end, s.start + s.duration);
    if (b > a) out.push({ start: a, end: b, tones: chordTones(s.chord), root: s.chord.root });
  }
  return out;
}

/** Turn a plan into one Part per instrument, in concert pitch, each a single monophonic line. */
export function realize(
  melody: Voice,
  chords: ChordSpan[],
  plan: ArrangementPlan,
  timeSig: Score["timeSig"],
): Part[] {
  const mLen = measureLength(timeSig);
  const melNotes = placedNotes(melody);
  const out: Record<string, Placed[]> = Object.fromEntries(plan.ensemble.map((i) => [i, []]));
  const lastPitch: Record<string, number> = {};

  let barCursor = 0;
  for (const sec of plan.sections) {
    const w: Window = { start: barCursor * mLen, end: (barCursor + sec.bars) * mLen };
    barCursor += sec.bars;
    const spans = spansIn(chords, w);
    const clip = (n: Placed): Placed | null => {
      const a = Math.max(n.start, w.start);
      const b = Math.min(n.start + n.duration, w.end);
      return b > a ? { ...n, start: a, duration: b - a, tieToNext: false } : null;
    };
    const inWindow = melNotes.map(clip).filter((n): n is Placed => !!n);

    // pad instruments low -> high so chord tones stack sensibly
    const padIds = plan.ensemble
      .filter((i) => sec.roles[i] === "pad")
      .sort((a, b) => centre(INSTRUMENTS[a]) - centre(INSTRUMENTS[b]));

    for (const id of plan.ensemble) {
      const inst = INSTRUMENTS[id];
      const role = sec.roles[id] ?? "tacet";
      const line = out[id];

      if (role === "melody" || role === "double") {
        const shift = bestShift(inWindow.map((n) => n.pitches[0]), inst);
        for (const n of inWindow) {
          line.push({ start: n.start, duration: n.duration, pitches: [fitToRange(n.pitches[0] + shift, inst)] });
        }
      } else if (role === "pad") {
        const k = padIds.indexOf(id);
        const order = padIds.length === 1 ? [1] : [0, 2, 1, 3, 0, 2];
        spans.forEach((sp, si) => {
          const slot = order[k % order.length] % sp.tones.length;
          const pc = sp.tones[slot];
          const target = lastPitch[id] ?? centre(inst);
          const pitch = nearestPc(pc, target, inst);
          lastPitch[id] = pitch;
          const prev = line[line.length - 1];
          const tie = si > 0 && prev && prev.pitches[0] === pitch && prev.start + prev.duration === sp.start;
          if (tie) prev.tieToNext = true;
          line.push({ start: sp.start, duration: sp.end - sp.start, pitches: [pitch] });
        });
      } else if (role === "bass") {
        for (const sp of spans) {
          const pitch = nearestPc(sp.root, inst.lo + 5, inst);
          const unit = 8;
          for (let t = sp.start; t < sp.end; t += unit) {
            line.push({ start: t, duration: Math.min(unit, sp.end - t), pitches: [pitch] });
          }
        }
      } else if (role === "rhythm") {
        for (const sp of spans) {
          const pc = sp.tones[1 % sp.tones.length];
          const pitch = nearestPc(pc, centre(inst), inst);
          for (let t = sp.start; t < sp.end; t += 2) {
            line.push({ start: t, duration: Math.min(2, sp.end - t), pitches: [pitch] });
          }
        }
      } else if (role === "counter") {
        let prev = lastPitch[id] ?? centre(inst) - 4;
        for (const sp of spans) {
          for (let t = sp.start; t < sp.end; t += 8) {
            const melAt = inWindow.find((n) => n.start <= t && t < n.start + n.duration)?.pitches[0];
            const cands = sp.tones
              .map((pc) => nearestPc(pc, prev, inst))
              .filter((p) => melAt === undefined || p % 12 !== melAt % 12);
            const pick = (cands.length ? cands : [prev]).sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev))[0];
            prev = pick;
            line.push({ start: t, duration: Math.min(8, sp.end - t), pitches: [pick] });
          }
        }
        lastPitch[id] = prev;
      }
    }
  }

  return plan.ensemble
    .filter((id) => out[id].length)
    .map((id) => ({
      id: `orch-${id}`,
      name: INSTRUMENTS[id].name,
      instrument: { program: INSTRUMENTS[id].program, clef: INSTRUMENTS[id].clef },
      voices: [voiceFromPlacedNotes(out[id])],
    }));
}

export function barsOf(voice: Voice, timeSig: Score["timeSig"]): number {
  return Math.max(1, Math.ceil(voiceLength(voice) / measureLength(timeSig)));
}
