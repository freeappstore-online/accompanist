// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { loadOwnPoints, resolveRange, saveOwnPoints } from './points';

const measures = [0, 1, 2, 3, 4].map(i => ({ number: i + 1, label: String(i), start: i * 4, end: i * 4 + 4 }));
const phrases = [{ name: 'Caro mio ben', bar: 1 }, { name: 'Il tuo fedel', bar: 3 }];
const own = [{ name: 'verse two', bar: 2, end: 3 }];

it('resolves bars, names, phrases and ranges to measure indexes', () => {
  const points = [...phrases, ...own];
  expect(resolveRange(measures, points, phrases, { bar: 2 })).toEqual({ first: 2 });
  expect(resolveRange(measures, points, phrases, { bar: 1 }, { bar: 3 })).toEqual({ first: 1, last: 3 });
  // Stopping at a named point stops where it starts; an own point with an end plays to its end.
  expect(resolveRange(measures, points, phrases, { start: true }, { name: 'Il tuo fedel' })).toEqual({ first: 0, last: 2 });
  expect(resolveRange(measures, points, phrases, { name: 'verse two' })).toEqual({ first: 2, last: 3 });
  expect(resolveRange(measures, points, phrases, { phrase: 2 })).toEqual({ first: 3 });
  expect(resolveRange(measures, points, phrases, { bar: 9 })).toMatch(/no bar 9/);
  expect(resolveRange(measures, points, phrases, { bar: 3 }, { bar: 1 })).toMatch(/before the start/);
  expect(resolveRange(measures, points, phrases, { name: 'chorus' })).toMatch(/no point called/);
});

it('keeps own points per song on this device and ignores damaged data', () => {
  saveOwnPoints('song-a', own);
  expect(loadOwnPoints('song-a')).toEqual(own);
  expect(loadOwnPoints('song-b')).toEqual([]);
  localStorage.setItem('accompanist:points:song-c', '{oops');
  expect(loadOwnPoints('song-c')).toEqual([]);
});
