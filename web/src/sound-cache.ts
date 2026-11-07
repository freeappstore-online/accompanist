import bank from './sound-bank.json';
export const SOUND_BANK = bank;
/** Bundled static asset, automatically precached with the app by its service worker. */
export async function loadSoundBank(): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(bank.url, { signal: controller.signal });
    if (!response.ok) throw new Error('load');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== bank.bytes) throw new Error('size');
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    if ([...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('') !== bank.sha256) throw new Error('integrity');
    return bytes;
  } catch { throw new Error('Instrument audio could not load. Check your connection and try again.'); }
  finally { clearTimeout(timeout); }
}
