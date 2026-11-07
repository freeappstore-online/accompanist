import { parseMidi, type Song } from './music';
import { readMusicXml } from './original-score';

export type SongInfo = { id: string; title: string; composer: string; source: string; sourceUrl: string; rights: string; edition: string; license: string };
export type Measure = ReturnType<typeof readMusicXml>['measures'][number];
export type LoadedSong = { info: SongInfo; song: Song; xml: string; measures: Measure[] };

const OPERA = { source: 'Project Gutenberg · The Baby’s Opera', sourceUrl: 'https://www.gutenberg.org/ebooks/25418', rights: 'Public domain historic source',
  edition: 'The Baby’s Opera, illustrated by Walter Crane (1845–1915), published by Frederick Warne and Co.; music transcribed by Linda Cantoni.', license: '/songs/gutenberg-opera-license.txt' };

/** Static per-song assets live in /songs/<id>/ and load on demand; see README for provenance. */
export const SONGS: SongInfo[] = [
  { id: 'caro-mio-ben', title: 'Caro mio ben', composer: 'Attributed to Giuseppe Giordani (some sources: Tommaso Giordani)', source: 'Mutopia Project',
    sourceUrl: 'https://www.mutopiaproject.org/ftp/GiordanoG/caromioben/', rights: 'Public domain', edition: 'Typeset by Peter Chubb from the Boosey and Hawkes 1903 edition; the piano part plays and the voice is yours.',
    license: '/songs/mutopia-caro-mio-ben.txt' },
  { id: 'three-blind-mice', title: 'Three Blind Mice', composer: 'Traditional', ...OPERA },
  { id: 'baa-baa-black-sheep', title: 'Baa, Baa, Black Sheep', composer: 'Traditional', ...OPERA },
  { id: 'london-bridge', title: 'London Bridge', composer: 'Traditional · arranged by Lucy Crane', source: 'Project Gutenberg · The Baby’s Bouquet', sourceUrl: 'https://www.gutenberg.org/ebooks/25432',
    rights: 'Public domain source (1878)', edition: 'Tunes collected and arranged by Lucy Crane (1842–1882); music transcribed by Linda Cantoni.', license: '/songs/gutenberg-license.txt' },
];

export async function loadSong(info: SongInfo, signal?: AbortSignal): Promise<LoadedSong> {
  const get = async (file: string) => {
    const response = await fetch(`/songs/${info.id}/${file}`, { signal });
    if (!response.ok) throw new Error(`${info.title} could not load. Check your connection and try again.`);
    return response;
  };
  const [midi, xmlText] = await Promise.all([get('accompaniment.mid').then(r => r.arrayBuffer()), get('score.musicxml').then(r => r.text())]);
  const score = readMusicXml(xmlText);
  return { info, song: parseMidi(midi, info.title), xml: score.xml, measures: score.measures };
}

/** The measure a spoken or typed bar number refers to: its printed label, so a pickup bar stays bar 0. */
export function findBar(measures: Measure[], bar: number) {
  return measures.findIndex(m => m.label === String(bar));
}
