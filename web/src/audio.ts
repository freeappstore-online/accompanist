import { Accompanist } from './accompanist';
import type { Piano } from './piano';

/** One AudioContext, sampled piano and count-in click for the app. Created on the first user gesture. */
export async function createAudio() {
  // iPhone mutes web audio with the ring/silent switch unless the page asks for a playback session (Safari 17+).
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = 'playback';
  const context = new AudioContext();
  await context.resume();
  const master = context.createGain();
  master.gain.value = .8;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -8; compressor.knee.value = 12; compressor.ratio.value = 4;
  compressor.connect(master); master.connect(context.destination);
  let piano: Piano;
  try { piano = await (await import('./piano')).Piano.create(context, compressor); }
  catch (error) { void context.close(); throw error; }
  const click = (when: number, accent: boolean) => {
    const osc = context.createOscillator(), gain = context.createGain();
    osc.frequency.setValueAtTime(accent ? 1500 : 1000, when);
    gain.gain.setValueAtTime(.4, when); gain.gain.exponentialRampToValueAtTime(.001, when + .035);
    osc.connect(gain); gain.connect(context.destination);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start(when); osc.stop(when + .04);
  };
  const player = new Accompanist(() => context.currentTime, piano, click);
  const resume = () => { if (context.state !== 'running' && context.state !== 'closed') void context.resume().catch(() => {}); };
  // Phones suspend audio for the lock screen, calls and when the microphone starts.
  const wake = () => { if (document.visibilityState === 'visible') resume(); };
  context.addEventListener('statechange', wake);
  document.addEventListener('visibilitychange', wake);
  return { player, resume, destroy: () => { context.removeEventListener('statechange', wake); document.removeEventListener('visibilitychange', wake); player.stop(); piano.destroy(); void context.close(); } };
}
