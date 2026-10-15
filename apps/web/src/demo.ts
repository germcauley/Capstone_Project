import { note, rest, type Score } from "@composer/core";

/** "Ode to Joy" opening in C major, quarter = 4 sixteenths. */
export const demoScore: Score = {
  title: "Ode to Joy (demo)",
  bpm: 100,
  timeSig: { beats: 4, beatType: 4 },
  keyFifths: 0,
  parts: [
    {
      id: "P1",
      name: "Melody",
      instrument: { program: 0, clef: "treble" },
      voices: [
        {
          events: [
            note(64, 4), note(64, 4), note(65, 4), note(67, 4),
            note(67, 4), note(65, 4), note(64, 4), note(62, 4),
            note(60, 4), note(60, 4), note(62, 4), note(64, 4),
            note(64, 6), note(62, 2), note(62, 8),
          ],
        },
      ],
    },
    {
      id: "P2",
      name: "Bass",
      instrument: { program: 0, clef: "bass" },
      voices: [
        {
          events: [
            note([48, 55, 64], 16),
            note([43, 50, 59], 16),
            note([48, 55, 64], 16),
            note([43, 50, 59], 16),
          ],
        },
      ],
    },
  ],
};
export { rest };
