type Recognition = {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null;
  start(): void; stop(): void; abort(): void;
};
type RecognitionCtor = new () => Recognition;

const Ctor = typeof window === 'undefined' ? undefined : (window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;
export const voiceSupported = !!Ctor;

/**
 * Continuous command listening with the browser's speech recognition. Unlike
 * dictation, every finished phrase is delivered as soon as it is recognised,
 * and recognition restarts when the browser ends a session after silence.
 */
export class VoiceCommands {
  private recognition?: Recognition;
  private listening = false;
  constructor(private onPhrase: (text: string) => void, private onState: (listening: boolean, error?: string) => void) {}
  start() {
    if (!Ctor || this.listening) return;
    const recognition = this.recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i++) if (event.results[i].isFinal) this.onPhrase(event.results[i][0].transcript.trim());
    };
    recognition.onerror = event => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') this.end('Microphone access was blocked. Allow it in your browser settings to use voice commands.');
      else if (event.error === 'audio-capture') this.end('No microphone was found.');
    };
    recognition.onend = () => { if (this.listening) try { recognition.start(); } catch { this.end(); } };
    this.listening = true;
    recognition.start();
    this.onState(true);
  }
  stop() { this.end(); }
  private end(error?: string) {
    const was = this.listening;
    this.listening = false;
    this.recognition?.abort();
    this.recognition = undefined;
    if (was || error) this.onState(false, error);
  }
}
