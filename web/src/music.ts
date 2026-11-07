import { Midi } from '@tonejs/midi';

export type Note = { midi: number; time: number; duration: number; velocity: number; track: number; beat: number; beats: number };
export type Song = { title: string; duration: number; bpm: number; tracks: { name: string; instrument: string; program?: number; percussion: boolean }[]; notes: Note[];
  tempos: { beat: number; time: number; bpm: number }[]; meters: { beat: number; numerator: number; denominator: number }[] };
export const MAX_FILE_SIZE = 5 * 1024 * 1024;

export function parseMidi(bytes: ArrayBuffer, filename: string): Song {
  if (bytes.byteLength > MAX_FILE_SIZE) throw new Error('Please choose a MIDI file smaller than 5 MB.');
  const h = new DataView(bytes);
  if (bytes.byteLength < 14 || h.getUint32(0) !== 0x4d546864) throw new Error('This is not a MIDI file. Choose a .mid or .midi file.');
  if (h.getUint16(8) > 1) throw new Error('This MIDI format is not supported. Export a standard format 0 or 1 MIDI file.');
  if (h.getUint16(12) & 0x8000) throw new Error('SMPTE-timed MIDI is not supported. Export MIDI using musical beat timing.');
  if (!h.getUint16(12)) throw new Error('The MIDI file has invalid timing.');
  let midi: Midi;
  try { midi = new Midi(bytes); } catch { throw new Error('This MIDI file could not be read. Try exporting it again.'); }
  // Tone's time map uses the first tempo for elapsed time before that event.
  // Supply MIDI's default so a delayed first tempo does not shift later notes.
  if (midi.header.tempos[0]?.ticks > 0) {
    midi.header.tempos.unshift({ ticks: 0, bpm: 120 });
    midi.header.update();
  }
  const tracks = midi.tracks.filter(t => t.notes.length);
  if (tracks.reduce((n, t) => n + t.notes.length, 0) > 100000) throw new Error('This file is too complex. Please use a MIDI file with fewer than 100,000 notes.');
  const notes: Note[] = [];
  tracks.forEach((track, i) => {
    const pedal = track.controlChanges[64] ?? [];
    const nextRelease: (number | undefined)[] = new Array(pedal.length);
    let release: number | undefined;
    for (let j = pedal.length - 1; j >= 0; j--) { if (pedal[j].value < .5) release = pedal[j].time; nextRelease[j] = release; }
    track.notes.forEach(n => {
      let end = n.time + n.duration;
      // Honour sustain pedal releases, while avoiding an indefinitely held final pedal.
      let low = 0, high = pedal.length;
      while (low < high) { const mid = (low + high) >>> 1; if (pedal[mid].time <= end) low = mid + 1; else high = mid; }
      if (low > 0 && pedal[low - 1].value >= .5 && !track.instrument.percussion) end = nextRelease[low] ?? end;
      if (Number.isFinite(n.time) && Number.isFinite(end) && n.time >= 0 && end > n.time) {
        notes.push({ midi: n.midi, time: n.time, duration: end - n.time, velocity: n.velocity, track: i, beat: n.ticks / midi.header.ppq, beats: n.durationTicks / midi.header.ppq });
      }
    });
  });
  if (!notes.length) throw new Error('This MIDI file contains no playable notes.');
  const duration = notes.reduce((end, n) => Math.max(end, n.time + n.duration), 0);
  if (duration > 7200) throw new Error('Please use a MIDI file shorter than two hours.');
  return { title: midi.name.trim() || filename.replace(/\.midi?$/i, ''), duration, bpm: midi.header.tempos[0]?.bpm ?? 120,
    tracks: tracks.map((t, i) => ({ name: t.name || `Track ${i + 1}`, instrument: t.instrument.name, program: t.instrument.number, percussion: t.instrument.percussion })),
    notes: notes.sort((a, b) => a.time - b.time),
    tempos: [{ beat: 0, time: 0, bpm: 120 }, ...midi.header.tempos.map(t => ({ beat: t.ticks / midi.header.ppq, time: midi.header.ticksToSeconds(t.ticks), bpm: t.bpm }))],
    meters: [{ beat: 0, numerator: 4, denominator: 4 }, ...midi.header.timeSignatures.map(t => ({ beat: t.ticks / midi.header.ppq, numerator: t.timeSignature[0], denominator: t.timeSignature[1] }))] };
}

export function beatAtTime(song: Song, time: number) {
  const tempo = [...song.tempos].reverse().find(t => t.time <= time) ?? song.tempos[0];
  return tempo.beat + (time - tempo.time) * tempo.bpm / 60;
}
export function timeAtBeat(song: Song, beat: number) {
  const tempo = [...song.tempos].reverse().find(t => t.beat <= beat) ?? song.tempos[0];
  return tempo.time + (beat - tempo.beat) * 60 / tempo.bpm;
}

export function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}
