import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Accompanist, noteEvents, type Instrument } from './accompanist';
import type { Song } from './music';

const song: Song = {
  title: 'Test', duration: 4, bpm: 60,
  tracks: [{ name: 'Piano', instrument: 'piano', program: 0, percussion: false }],
  notes: [0, 1, 2, 3].map(t => ({ midi: 60 + t, time: t, duration: 1, velocity: .5, track: 0, beat: t, beats: 1 })),
  tempos: [{ beat: 0, time: 0, bpm: 60 }], meters: [{ beat: 0, numerator: 3, denominator: 4 }],
};

let now = 0;
let log: string[] = [];
const instrument: Instrument = {
  session: () => log.push('session'),
  noteOn: (midi, _v, time) => log.push(`on ${midi} @${time.toFixed(2)}`),
  noteOff: (midi, time) => log.push(`off ${midi} @${time.toFixed(2)}`),
  silence: () => log.push('silence'),
};
const clicks: [number, boolean][] = [];
const make = () => { const a = new Accompanist(() => now, instrument, (w, accent) => clicks.push([w, accent])); a.load(song); return a; };

beforeEach(() => { vi.useFakeTimers(); now = 10; log = []; clicks.length = 0; });
afterEach(() => vi.useRealTimers());

it('orders note-offs before note-ons at the same time and applies transposition', () => {
  const events = noteEvents(song, 2);
  expect(events.slice(1, 3)).toEqual([{ time: 1, midi: 62, velocity: 0, on: false }, { time: 1, midi: 63, velocity: .5, on: true }]);
});

it('starts from a bar after a one-bar count-in and schedules only within the look-ahead', () => {
  const a = make();
  a.start(2, true);
  expect(clicks.map(c => c[1])).toEqual([true, false, false]);
  expect(clicks[0][0]).toBeCloseTo(10.05);
  expect(a.countingIn).toBe(true);
  expect(a.time).toBe(2);
  expect(log).toEqual(['session']);
  now = 13.05 - .1; a.tick();
  expect(log).toEqual(['session', 'on 62 @13.05']);
  now = 14; a.tick();
  expect(log.slice(2)).toEqual(['off 62 @14.05', 'on 63 @14.05']);
});

it('re-anchors on speed changes so later notes follow the new tempo', () => {
  const a = make();
  a.start(0, false);
  now = 11.05; a.setSpeed(2);
  expect(a.time).toBeCloseTo(1);
  now = 11.5; a.tick();
  expect(log).toContain('on 62 @11.55');
});

it('stops, silences and resumes from where it stopped; ends at the song duration', () => {
  const a = make();
  a.start(0, false);
  now = 11.55; a.stop();
  expect(log.at(-1)).toBe('silence');
  expect(a.time).toBeCloseTo(1.5);
  expect(a.playing).toBe(false);
  a.start(a.time, false);
  now = 12; a.tick();
  expect(log.filter(l => l.startsWith('on')).at(-1)).toBe('on 62 @12.10');
  const updates: boolean[] = []; a.onUpdate = (_t, playing) => updates.push(playing);
  now = 20; a.tick();
  expect(a.playing).toBe(false);
  expect(a.time).toBe(4);
  expect(updates.at(-1)).toBe(false);
});
