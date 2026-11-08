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

it('stops at the end of a range without queuing notes past it', () => {
  const a = make();
  a.start(1, false, { until: 3 });
  for (now = 10; now < 12.2; now += .025) a.tick();
  expect(a.playing).toBe(false);
  expect(a.time).toBe(3);
  expect(log.filter(l => l.startsWith('on'))).toEqual(['on 61 @10.05', 'on 62 @11.05']);
  expect(log.at(-1)).toBe('silence');
});

it('loops a range back to its start', () => {
  const a = make();
  a.start(1, false, { until: 2, loop: true });
  for (now = 10; now < 12.2; now += .025) a.tick();
  expect(a.playing).toBe(true);
  expect(log.filter(l => l.startsWith('on')).length).toBeGreaterThanOrEqual(2);
  expect(log.filter(l => l === 'session').length).toBeGreaterThanOrEqual(2);
  expect(a.time).toBeGreaterThanOrEqual(1);
  expect(a.time).toBeLessThan(2);
});

it('keeps the start of a loop when the key changes mid-phrase', () => {
  const a = make();
  a.start(1, false, { until: 3, loop: true });
  now += 1.5;
  a.setTranspose(2);
  expect(a.until).toBe(3);
  expect(a.loop).toBe(true);
  expect(a.loopFrom).toBe(1);
});

it('loops back to loopFrom, not to where playback resumed', () => {
  const a = make();
  a.start(2.5, false, { until: 3, loop: true, loopFrom: 1 });
  now += .6;
  a.tick();
  expect(a.time).toBeLessThan(1.1);
  expect(a.playing).toBe(true);
});

it('keeps the position and reports it when the key changes while stopped', () => {
  const a = make();
  const updates: number[] = [];
  a.start(2, false);
  a.stop();
  a.onUpdate = t => updates.push(t);
  a.setTranspose(1);
  expect(a.time).toBe(2);
  expect(updates.at(-1)).toBe(2);
});

it('forgets the stop point when another song loads', () => {
  const a = make();
  a.start(0, false, { until: 2, loop: true });
  a.stop();
  a.load(song);
  expect(a.until).toBe(Infinity);
  expect(a.loop).toBe(false);
});
