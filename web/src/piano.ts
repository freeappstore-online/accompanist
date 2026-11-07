import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import { loadSoundBank } from './sound-cache';
import type { Instrument } from './accompanist';

const CHANNELS = 8;

/**
 * Sampled grand piano. Notes are queued at AudioContext times shortly ahead,
 * and the synth cannot cancel queued events, so every playback session gets
 * its own MIDI channel: silencing a session mutes its channel, and any events
 * still queued for it sound at zero volume.
 */
export class Piano implements Instrument {
  private channel = 0;
  private constructor(private synth: WorkletSynthesizer) {}
  static async create(context: AudioContext, destination: AudioNode) {
    if (!context.audioWorklet) throw new Error('This browser cannot play the sampled piano. Try a current version of Chrome, Edge, Firefox or Safari.');
    const [bytes] = await Promise.all([loadSoundBank(), context.audioWorklet.addModule(processorUrl)]);
    const synth = new WorkletSynthesizer(context);
    try {
      synth.setLogLevel(false, true, false);
      synth.connect(destination);
      synth.setSystemParameter('voiceCap', 256);
      synth.setSystemParameter('reverbGain', .35);
      synth.setSystemParameter('chorusGain', 0);
      await synth.soundBankManager.addSoundBank(bytes, 'generaluser');
      await synth.isReady;
      for (let channel = 0; channel < CHANNELS; channel++) { synth.programChange(channel, 0); synth.controllerChange(channel, 91, 28); synth.controllerChange(channel, 7, 0); }
      return new Piano(synth);
    } catch (error) { synth.destroy(); throw error; }
  }
  session() {
    this.silence();
    this.channel = (this.channel + 1) % CHANNELS;
    this.synth.controllerChange(this.channel, 7, 100);
  }
  noteOn(midi: number, velocity: number, time: number) { this.synth.noteOn(this.channel, midi, Math.max(1, Math.round(velocity * 127)), { time }); }
  noteOff(midi: number, time: number) { this.synth.noteOff(this.channel, midi, { time }); }
  silence() { this.synth.controllerChange(this.channel, 7, 0); this.synth.stopAll(true); }
  destroy() { this.synth.destroy(); }
}
