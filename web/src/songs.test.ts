// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import provenance from '../songs-provenance.json';
import { beatAtTime, parseMidi } from './music';
import { readMusicXml } from './original-score';
import { findBar, SONGS } from './songs';

// Large scores (Ave Maria's arpeggios) take a few seconds to parse in happy-dom.
vi.setConfig({ testTimeout: 30_000 });

it.each(SONGS.map(s => [s.id]))('%s: pinned assets, playable MIDI and a bar map that matches it', id => {
  const files = provenance[id as keyof typeof provenance];
  expect(files).toBeDefined();
  const bytes = Object.fromEntries(Object.keys(files).map(file => [file, readFileSync(resolve(`public/songs/${id}/${file}`))]));
  for (const [file, { sha256 }] of Object.entries(files)) expect(createHash('sha256').update(bytes[file]).digest('hex'), file).toBe(sha256);
  const song = parseMidi(Uint8Array.from(bytes['accompaniment.mid']).buffer, id);
  const { measures } = readMusicXml(bytes['score.musicxml'].toString('utf8'));
  expect(song.notes.length).toBeGreaterThan(20);
  // Every bar the singer can name resolves, and the MIDI ends inside the score's last bar.
  measures.forEach((m, i) => expect(findBar(measures, Number(m.label))).toBe(i));
  const end = beatAtTime(song, song.duration);
  expect(end).toBeGreaterThan(measures.at(-1)!.start);
  expect(end).toBeLessThanOrEqual(measures.at(-1)!.end + 1e-6);
});

it.each(SONGS.filter(s => s.phrases).map(s => [s.id]))('%s plays the piano only, and its start points are real bars', id => {
  const song = parseMidi(Uint8Array.from(readFileSync(resolve(`public/songs/${id}/accompaniment.mid`))).buffer, id);
  expect(song.tracks.filter(t => song.notes.some(n => song.tracks[n.track] === t))).toHaveLength(2);
  const { measures } = readMusicXml(readFileSync(resolve(`public/songs/${id}/score.musicxml`), 'utf8'));
  for (const point of SONGS.find(s => s.id === id)!.phrases!) expect(findBar(measures, point.bar), point.name).toBeGreaterThanOrEqual(0);
});
