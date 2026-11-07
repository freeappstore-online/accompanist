import { beatAtTime, type Song } from './music';

export function transposeBounds(song: Song) {
  let low = 127, high = 0, pitched = false;
  for (const note of song.notes) if (!song.tracks[note.track].percussion) { pitched = true; low = Math.min(low, note.midi); high = Math.max(high, note.midi); }
  return pitched ? { min: Math.max(-12, -low), max: Math.min(12, 127 - high) } : { min: 0, max: 0 };
}
export const pitchLabel = (value: number) => value === 0 ? 'Original key' : `${value > 0 ? '+' : '−'}${Math.abs(value)} semitone${Math.abs(value) === 1 ? '' : 's'}`;
/** Meter and beat length at a time; compound meters count dotted beats (6/8 → 2 beats). */
export function rhythmAt(song: Song, time: number) {
  const beat = beatAtTime(song, time);
  const meter = [...song.meters].reverse().find(m => m.beat <= beat && m.numerator > 0 && m.numerator <= 32 && [1,2,4,8,16,32].includes(m.denominator)) ?? { beat: 0, numerator: 4, denominator: 4 };
  const compound = meter.denominator >= 8 && meter.numerator > 3 && meter.numerator % 3 === 0;
  const step = 4 / meter.denominator * (compound ? 3 : 1);
  const bpm = ([...song.tempos].reverse().find(t => t.time <= time)?.bpm ?? 120);
  return { meter, step, beatsPerBar: meter.numerator / (compound ? 3 : 1), secondsPerBeat: 60 / bpm * step, bpm };
}
