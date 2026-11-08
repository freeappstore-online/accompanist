import type { Ref } from './commands';
import { findBar, type Measure, type Point } from './songs';

const key = (songId: string) => `accompanist:points:${songId}`;
const valid = (p: unknown): p is Point => !!p && typeof (p as Point).name === 'string' && Number.isInteger((p as Point).bar)
  && ((p as Point).end === undefined || Number.isInteger((p as Point).end));

/** A singer's own named points for a song, kept on this device only. */
export function loadOwnPoints(songId: string): Point[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key(songId)) ?? '[]');
    return Array.isArray(stored) ? stored.filter(valid) : [];
  } catch { return []; }
}
export function saveOwnPoints(songId: string, points: Point[]) {
  try { localStorage.setItem(key(songId), JSON.stringify(points)); } catch { /* private mode: points last for this visit */ }
}

/**
 * Measure indexes for a start (and optional stop) reference, or why it can't be played.
 * A stop at a bar plays through that bar; a stop at a named point stops where that point starts.
 */
export function resolveRange(measures: Measure[], points: Point[], phrases: Point[], from: Ref, to?: Ref): { first: number; last?: number } | string {
  const lookup = (ref: Ref): { index: number; point?: Point } | string => {
    if ('start' in ref) return { index: 0 };
    if ('bar' in ref) {
      const index = findBar(measures, ref.bar);
      return index < 0 ? `There is no bar ${ref.bar}. This song has bars ${measures[0].label}–${measures.at(-1)!.label}.` : { index };
    }
    const point = 'phrase' in ref ? phrases[ref.phrase - 1] : points.find(p => p.name === ref.name);
    if (!point) return 'phrase' in ref ? `This song has ${phrases.length} phrases.` : `There is no point called “${ref.name}”.`;
    const index = findBar(measures, point.bar);
    return index < 0 ? `“${point.name}” is at bar ${point.bar}, which this song doesn’t have.` : { index, point };
  };
  const start = lookup(from);
  if (typeof start === 'string') return start;
  let last: number | undefined;
  if (to) {
    const stop = lookup(to);
    if (typeof stop === 'string') return stop;
    last = 'bar' in to ? stop.index : stop.index - 1;
  } else if (start.point?.end !== undefined) {
    const end = findBar(measures, start.point.end);
    if (end >= 0) last = end;
  }
  if (last !== undefined && last < start.index) return 'The stop point comes before the start.';
  return { first: start.index, last };
}
