import { describe, expect, it } from "vitest";
import {
  ENSEMBLES, INSTRUMENTS, barsOf, buildPlanPrompt, defaultPlan, harmonize, normalizePlan, note,
  parsePlan, placedNotes, realize, voiceLength, type Voice,
} from "./index.js";

const melody: Voice = {
  events: [
    ...[64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62].map((p, i) => note(p, i === 12 ? 6 : i === 13 ? 2 : i === 14 ? 8 : 4)),
    ...[64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60].map((p, i) => note(p, i === 12 ? 6 : i === 13 ? 2 : i === 14 ? 8 : 4)),
  ],
};
const timeSig = { beats: 4, beatType: 4 };
const chords = harmonize(melody, { keyFifths: 0, mode: "major", timeSig });
const bars = barsOf(melody, timeSig);

describe("defaultPlan", () => {
  it("covers every bar and always has a melody", () => {
    for (const ens of Object.values(ENSEMBLES)) {
      const p = defaultPlan(bars, ens.instruments);
      expect(p.sections.reduce((s, x) => s + x.bars, 0)).toBe(bars);
      p.sections.forEach((s) => expect(Object.values(s.roles)).toContain("melody"));
    }
  });
  it("starts lighter than it ends", () => {
    const p = defaultPlan(bars, ENSEMBLES.orchestra.instruments);
    const active = (i: number) => Object.values(p.sections[i].roles).filter((r) => r !== "tacet").length;
    expect(active(p.sections.length - 1)).toBeGreaterThan(active(0));
  });
  it("handles very short melodies", () => {
    expect(defaultPlan(1, ["vn1", "vc"]).sections.map((s) => s.bars)).toEqual([1]);
    expect(defaultPlan(3, ["vn1", "vc"]).sections.reduce((s, x) => s + x.bars, 0)).toBe(3);
  });
});

describe("normalizePlan", () => {
  const ens = ["vn1", "vn2", "va", "vc"];
  it("falls back to the rule plan on junk", () => {
    expect(normalizePlan({ nope: 1 }, 8, ens).sections.length).toBeGreaterThan(0);
  });
  it("trims or extends to the exact bar count", () => {
    const long = normalizePlan({ sections: [{ bars: 6, roles: { vn1: "melody" } }, { bars: 6, roles: { vn1: "melody" } }] }, 8, ens);
    expect(long.sections.map((s) => s.bars)).toEqual([6, 2]);
    const short = normalizePlan({ sections: [{ bars: 2, roles: { vn1: "melody" } }] }, 8, ens);
    expect(short.sections[0].bars).toBe(8);
  });
  it("ignores unknown instruments and roles, forces a melody", () => {
    const p = normalizePlan({ sections: [{ bars: 8, roles: { kazoo: "melody", vn1: "shred", vc: "bass" } }] }, 8, ens);
    expect(p.sections[0].roles.kazoo).toBeUndefined();
    expect(p.sections[0].roles.vn1).toBe("melody");
    expect(p.sections[0].roles.vc).toBe("bass");
  });
  it("parses fenced model text", () => {
    const p = parsePlan("```json\n" + JSON.stringify({ sections: [{ name: "A", bars: 8, roles: { vn1: "melody" } }] }) + "\n```", 8, ens);
    expect(p.sections[0].name).toBe("A");
  });
});

describe("buildPlanPrompt", () => {
  it("lists instruments and the exact bar total", () => {
    const p = buildPlanPrompt({ bars: 8, ensemble: ["vn1", "vc"], keyName: "C major", melodyRange: [60, 72], timeSig });
    expect(p).toContain("vn1 = Violin I");
    expect(p).toContain("add up to exactly 8");
  });
});

describe("realize", () => {
  for (const [key, ens] of Object.entries(ENSEMBLES)) {
    describe(ens.name, () => {
      const plan = defaultPlan(bars, ens.instruments);
      const parts = realize(melody, chords, plan, timeSig);

      it("keeps every note inside its instrument's range", () => {
        for (const p of parts) {
          const inst = INSTRUMENTS[p.id.replace("orch-", "")];
          for (const n of placedNotes(p.voices[0])) {
            expect(n.pitches[0], `${key} ${inst.id}`).toBeGreaterThanOrEqual(inst.lo);
            expect(n.pitches[0], `${key} ${inst.id}`).toBeLessThanOrEqual(inst.hi);
          }
        }
      });
      it("never exceeds the melody length and has no overlaps", () => {
        for (const p of parts) {
          expect(voiceLength(p.voices[0])).toBeLessThanOrEqual(bars * 16);
          const ns = placedNotes(p.voices[0]);
          ns.forEach((n, i) => i > 0 && expect(n.start).toBeGreaterThanOrEqual(ns[i - 1].start + ns[i - 1].duration));
        }
      });
      it("gives the tune to someone in every section", () => {
        expect(parts.length).toBeGreaterThanOrEqual(ens.instruments.length - 2);
        const lead = parts.find((p) => p.id === `orch-${plan.sections[0].roles && Object.entries(plan.sections[0].roles).find(([, r]) => r === "melody")![0]}`)!;
        expect(placedNotes(lead.voices[0]).length).toBeGreaterThanOrEqual(placedNotes(melody).length / plan.sections.length);
      });
    });
  }

  it("bass role plays chord roots in the low register", () => {
    const plan = { ensemble: ["vn1", "vc"], sections: [{ name: "x", bars, roles: { vn1: "melody", vc: "bass" } as const }] };
    const parts = realize(melody, chords, plan as never, timeSig);
    const cello = placedNotes(parts.find((p) => p.id === "orch-vc")!.voices[0]);
    expect(cello[0].pitches[0] % 12).toBe(chords[0].chord.root);
    expect(Math.max(...cello.map((n) => n.pitches[0]))).toBeLessThanOrEqual(36 + 11 + 5);
  });

  it("tacet instruments produce no part", () => {
    const plan = { ensemble: ["vn1", "fl"], sections: [{ name: "x", bars, roles: { vn1: "melody", fl: "tacet" } as const }] };
    expect(realize(melody, chords, plan as never, timeSig).map((p) => p.id)).toEqual(["orch-vn1"]);
  });
});
