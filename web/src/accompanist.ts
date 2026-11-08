import type { Song } from './music';
import { rhythmAt } from './practice';

export interface Instrument {
  /** Start a new playback session, silencing the previous one. */
  session(): void;
  noteOn(midi: number, velocity: number, time: number): void;
  noteOff(midi: number, time: number): void;
  silence(): void;
}
type NoteEvent = { time: number; midi: number; velocity: number; on: boolean };

const LOOKAHEAD = .12, TICK_MS = 25, START_DELAY = .05;

/** Note-on/off events in song seconds; offs sort before ons at the same instant so repeated pitches retrigger. */
export function noteEvents(song: Song, transpose: number): NoteEvent[] {
  const events: NoteEvent[] = [];
  for (const note of song.notes) {
    if (song.tracks[note.track].percussion) continue;
    const midi = note.midi + transpose;
    if (midi < 0 || midi > 127) continue;
    events.push({ time: note.time, midi, velocity: note.velocity, on: true }, { time: note.time + note.duration, midi, velocity: 0, on: false });
  }
  return events.sort((a, b) => a.time - b.time || Number(a.on) - Number(b.on));
}

/**
 * Plays a song on an Instrument from any point. A short look-ahead scheduler
 * maps song time to audio time through an anchor and a speed, so speed (and,
 * later, a score follower) can change continuously without rebuilding playback.
 */
export class Accompanist {
  song: Song | null = null;
  playing = false;
  speed = 1;
  private transposeBy = 0;
  private events: NoteEvent[] = [];
  private index = 0;
  private position = 0;
  private anchor = { audio: 0, song: 0 };
  private timer?: ReturnType<typeof setInterval>;
  /** Where playback stops (song seconds), and whether it then jumps back to `loopFrom`. */
  until = Infinity;
  loop = false;
  loopFrom = 0;
  onUpdate: (time: number, playing: boolean) => void = () => {};

  constructor(private clock: () => number, private instrument: Instrument, private click: (when: number, accent: boolean) => void) {}

  get transpose() { return this.transposeBy; }
  /** Song seconds; holds at the start point during a count-in. */
  get time() {
    if (!this.playing) return this.position;
    return this.anchor.song + Math.max(0, this.clock() - this.anchor.audio) * this.speed;
  }
  get countingIn() { return this.playing && this.clock() < this.anchor.audio; }

  load(song: Song, transpose = 0) {
    this.stop();
    this.song = song; this.transposeBy = transpose; this.position = 0;
    this.until = Infinity; this.loop = false;
    this.events = noteEvents(song, transpose);
    this.onUpdate(0, false);
  }
  setTranspose(semitones: number) {
    if (!this.song) return;
    const time = this.time, playing = this.playing, { until, loop, loopFrom } = this;
    this.load(this.song, semitones);
    this.position = time; this.until = until; this.loop = loop; this.loopFrom = loopFrom;
    if (playing) this.start(time, false, { until, loop, loopFrom });
    else this.onUpdate(time, false);
  }
  /** Plays from `from` (song seconds) to `until`; when `loop` is set it then jumps to `loopFrom` (default: `from`). */
  start(from: number, countIn: boolean, range: { until?: number; loop?: boolean; loopFrom?: number } = {}) {
    if (!this.song) return;
    this.halt();
    from = Math.max(0, Math.min(from, this.song.duration));
    this.until = range.until && range.until > from ? range.until : Infinity;
    this.loop = !!range.loop && this.until < Infinity;
    this.loopFrom = range.loopFrom ?? from;
    this.instrument.session();
    let audio = this.clock() + START_DELAY;
    if (countIn) {
      const { beatsPerBar, secondsPerBeat } = rhythmAt(this.song, from + 1e-6);
      const interval = secondsPerBeat / this.speed;
      for (let i = 0; i < beatsPerBar; i++) this.click(audio + i * interval, i === 0);
      audio += beatsPerBar * interval;
    }
    this.anchor = { audio, song: from };
    this.index = this.events.findIndex(e => e.on && e.time >= from - 1e-6);
    if (this.index < 0) this.index = this.events.length;
    this.playing = true;
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }
  stop() {
    if (!this.playing) return;
    this.halt();
    this.instrument.silence();
    this.onUpdate(this.position, false);
  }
  setSpeed(speed: number) {
    if (this.playing && !this.countingIn) this.anchor = { audio: this.clock(), song: this.time };
    this.speed = speed;
  }
  private halt() {
    if (this.playing) this.position = Math.min(this.time, this.song?.duration ?? 0);
    this.playing = false;
    clearInterval(this.timer);
  }
  /** Queue every event due before the look-ahead horizon at its audio time. */
  tick() {
    if (!this.playing || !this.song) return;
    const now = this.clock();
    const horizon = this.anchor.song + Math.max(0, now + LOOKAHEAD - this.anchor.audio) * this.speed;
    const limit = Math.min(horizon, this.until);
    while (this.index < this.events.length && this.events[this.index].time < limit) {
      const event = this.events[this.index++];
      const when = Math.max(now, this.anchor.audio + (event.time - this.anchor.song) / this.speed);
      if (event.on) this.instrument.noteOn(event.midi, event.velocity, when);
      else this.instrument.noteOff(event.midi, when);
    }
    const time = this.time, end = Math.min(this.until, this.song.duration);
    if (time >= end) {
      if (this.loop) { this.start(this.loopFrom, false, { until: this.until, loop: true }); return; }
      this.halt();
      this.instrument.silence();
      this.position = end;
      this.onUpdate(this.position, false);
      return;
    }
    this.onUpdate(time, true);
  }
}
