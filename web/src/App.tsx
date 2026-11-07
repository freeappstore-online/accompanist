import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { initApp } from "@freeappstore/sdk";
import { Card, type NavItem, PageHeader, Shell } from "@freeappstore/sdk/ui";
import { createAudio } from "./audio";
import { parseCommand, type Command } from "./commands";
import { formatTime, timeAtBeat } from "./music";
import { pitchLabel, transposeBounds } from "./practice";
import Score from "./Score";
import { findBar, loadSong, SONGS, type LoadedSong } from "./songs";
import { VoiceCommands, voiceSupported } from "./voice";
import { SOUND_BANK } from "./sound-cache";

// "accompanist" is replaced by the CLI scaffold or deployment flow with this app's id.
export const fas = initApp({ appId: "accompanist" });

const NAV: NavItem[] = [
  { label: "Accompanist", href: "/", title: "Accompanist" },
  { label: "About", href: "/about", title: "About — Accompanist" },
];

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-panel disabled:cursor-not-allowed disabled:opacity-40";
const selected = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border-2 border-accent bg-accent px-4 py-2 text-sm font-bold text-paper shadow-sm disabled:cursor-not-allowed disabled:opacity-40";
const control = "min-h-11 rounded-xl border border-line bg-paper px-3 text-sm text-ink";
function Button({ primary, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return <button {...props} className={`${primary || props["aria-pressed"] === true ? selected : button} ${className}`} />;
}

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname);
  // Kept here so the chosen song survives visits to About and Profile.
  const [songId, setSongId] = useState(SONGS[0].id);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const navigate = (href: string) => {
    window.history.pushState(null, "", href);
    setPath(window.location.pathname);
  };
  return (
    <Shell app={fas} appName="Accompanist" nav={NAV} onNavigate={navigate}>
      <div className="mx-auto w-full max-w-4xl p-4 sm:p-8">
        {path === "/about" ? <About /> : <Home songId={songId} setSongId={setSongId} />}
      </div>
    </Shell>
  );
}

type Audio = Awaited<ReturnType<typeof createAudio>>;

function Home({ songId, setSongId }: { songId: string; setSongId: (id: string) => void }) {
  const [loaded, setLoaded] = useState<LoadedSong | null>(null);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const audio = useRef<Audio | null>(null), audioPromise = useRef<Promise<Audio> | null>(null);
  const [audioState, setAudioState] = useState<"idle" | "loading" | "ready">("idle");
  const [audioError, setAudioError] = useState("");
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1), [transpose, setTranspose] = useState(0), [countIn, setCountIn] = useState(true);
  const [listening, setListening] = useState(false), [voiceStatus, setVoiceStatus] = useState("");
  const [barInput, setBarInput] = useState("1"), [barError, setBarError] = useState("");
  const voice = useRef<VoiceCommands | null>(null);
  const loadedRef = useRef(loaded); loadedRef.current = loaded;

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(null); setLoadError(""); setTime(0); setTranspose(0);
    audio.current?.player.stop();
    loadSong(SONGS.find(s => s.id === songId)!, controller.signal)
      .then(song => { setLoaded(song); audio.current?.player.load(song.song, 0); })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "The song could not load."); });
    return () => controller.abort();
  }, [songId, retry]);

  // Leaving the screen (About, Profile) stops playback and listening.
  useEffect(() => () => { voice.current?.stop(); audio.current?.destroy(); audio.current = null; audioPromise.current = null; }, []);

  /** Created on the first click, which browsers require before audio can start. */
  const ensureAudio = () => {
    if (!audioPromise.current) {
      setAudioState("loading"); setAudioError("");
      audioPromise.current = createAudio().then(created => {
        created.player.onUpdate = (t, p) => { setTime(t); setPlaying(p); };
        created.player.speed = speed;
        if (loadedRef.current) created.player.load(loadedRef.current.song, transpose);
        audio.current = created; setAudioState("ready");
        return created;
      }).catch(error => {
        audioPromise.current = null; setAudioState("idle");
        setAudioError(error instanceof Error ? error.message : "The piano could not start.");
        throw error;
      });
    }
    return audioPromise.current;
  };

  const startAt = async (from: number, withCountIn = countIn) => {
    if (!loaded) return;
    const { player } = await ensureAudio();
    player.start(from, withCountIn);
  };
  const playBar = (index: number) => { if (loaded) void startAt(timeAtBeat(loaded.song, loaded.measures[index].start)).catch(() => {}); };
  /** Starts from a printed bar number, or returns why it can't. */
  const playFromNumber = (bar: number) => {
    if (!loaded) return "The song is still loading.";
    const index = findBar(loaded.measures, bar);
    if (index < 0) return `There is no bar ${bar}. This song has bars ${loaded.measures[0].label}–${loaded.measures[loaded.measures.length - 1].label}.`;
    playBar(index); return null;
  };
  const stop = () => audio.current?.player.stop();
  const play = () => { if (loaded) void startAt(time >= loaded.song.duration ? 0 : time).catch(() => {}); };
  const changeSpeed = (value: number) => {
    const next = Math.round(Math.min(1.5, Math.max(.5, value)) * 100) / 100;
    setSpeed(next); audio.current?.player.setSpeed(next);
  };
  const changeTranspose = (value: number) => { setTranspose(value); audio.current?.player.setTranspose(value); };

  const run = (command: Command) => {
    if (command.type === "from") return playFromNumber(command.bar) ?? `Playing from bar ${command.bar}`;
    if (command.type === "stop") { stop(); return "Stopped"; }
    if (command.type === "tempo") { changeSpeed(speed * command.factor); return command.factor < 1 ? "Slower" : "Faster"; }
    play(); return "Playing";
  };
  const runRef = useRef(run); runRef.current = run;

  const toggleVoice = () => {
    if (listening) { voice.current?.stop(); return; }
    void ensureAudio().catch(() => {});
    voice.current ??= new VoiceCommands(phrase => {
      const command = parseCommand(phrase);
      setVoiceStatus(`Heard “${phrase}” · ${command ? runRef.current(command) : "not a command"}`);
    }, (on, error) => { setListening(on); setVoiceStatus(error ?? (on ? "Listening for commands…" : "")); });
    voice.current.start();
  };

  const bounds = loaded ? transposeBounds(loaded.song) : { min: 0, max: 0 };
  const keys = Array.from({ length: Math.min(6, bounds.max) - Math.max(-6, bounds.min) + 1 }, (_, i) => Math.max(-6, bounds.min) + i);
  const submitBar = () => {
    const bar = Number(barInput);
    const error = Number.isInteger(bar) && barInput.trim() ? playFromNumber(bar) : "Enter a whole bar number.";
    setBarError(error ?? "");
  };

  return (
    <>
      <PageHeader title="Accompanist" description="Your piano accompanist. Choose a song, then say “from bar 5”, “play” or “stop”." />
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Song">
          {SONGS.map(s => <Button key={s.id} aria-pressed={s.id === songId} onClick={() => setSongId(s.id)}>{s.title}</Button>)}
        </div>

        <Card>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button primary className="min-w-28" disabled={!loaded || audioState === "loading"} onClick={() => playing ? stop() : play()}>
                {audioState === "loading" ? "Loading piano…" : playing ? "■ Stop" : "▶ Play"}
              </Button>
              <Button disabled={!loaded} onClick={() => playBar(0)}>⟲ From the beginning</Button>
              <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); submitBar(); }}>
                <label htmlFor="bar" className="text-sm">From bar</label>
                <input id="bar" inputMode="numeric" className={`${control} w-20`} value={barInput} aria-invalid={!!barError} aria-describedby={barError ? "bar-error" : undefined} onChange={e => { setBarInput(e.target.value); setBarError(""); }} />
                <Button type="submit" disabled={!loaded}>Go</Button>
              </form>
              <span className="ml-auto text-sm tabular-nums text-muted" aria-label="Position">{formatTime(time)} / {formatTime(loaded?.song.duration ?? 0)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <Button aria-pressed={listening} disabled={!voiceSupported} onClick={toggleVoice}>{listening ? "🎙 Listening — tap to stop" : "🎙 Voice commands"}</Button>
              <p role="status" aria-live="polite" className="text-sm text-muted">
                {!voiceSupported ? "Voice commands need a browser with speech recognition, such as Chrome, Edge or Safari." : voiceStatus || "Commands: “from bar 9”, “from the beginning”, “play”, “stop”, “slower”, “faster”. Headphones keep the piano out of the microphone."}
              </p>
            </div>
            {barError && <p id="bar-error" role="alert" className="text-sm text-danger">{barError}</p>}
            {audioError && <p role="alert" className="text-sm text-danger">{audioError} <button className="underline" onClick={() => void ensureAudio().catch(() => {})}>Try again</button></p>}
          </div>
        </Card>

        {loadError && <p role="alert" className="text-sm text-danger">{loadError} <button className="underline" onClick={() => setRetry(r => r + 1)}>Try again</button></p>}
        {!loaded && !loadError && <p role="status" className="text-sm text-muted">Loading song…</p>}
        {loaded && <Card><Score xml={loaded.xml} measures={loaded.measures} song={loaded.song} time={time} transpose={transpose} onBar={playBar} /></Card>}

        <Card>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start">
              <span className="text-sm">Tempo · {Math.round(speed * 100)}%</span>
              <div className="flex gap-2"><Button aria-label="Slower" onClick={() => changeSpeed(speed * .9)}>−</Button><Button aria-label="Normal tempo" onClick={() => changeSpeed(1)}>100%</Button><Button aria-label="Faster" onClick={() => changeSpeed(speed * 1.1)}>+</Button></div>
            </div>
            <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start">
              <label htmlFor="key" className="text-sm">Key</label>
              <select id="key" className={control} value={transpose} disabled={!loaded} onChange={e => changeTranspose(Number(e.target.value))}>
                {keys.map(k => <option key={k} value={k}>{pitchLabel(k)}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm sm:self-center"><input type="checkbox" checked={countIn} onChange={e => setCountIn(e.target.checked)} />One-bar count-in before starting</label>
          </div>
        </Card>
      </div>
    </>
  );
}

function About() {
  return (
    <>
      <PageHeader title="About" />
      <div className="space-y-5 text-sm leading-7">
        <Card>
          <p>Accompanist plays piano accompaniment for singers and starts from any bar when you ask. Choose a song, turn on voice commands and say “from bar 5”, “from the beginning”, “play”, “stop”, “slower” or “faster”. Everything also works with the buttons.</p>
          <p className="mt-3">Speech recognition is provided by your browser; in some browsers, such as Chrome, the audio is sent to the browser maker’s speech service. Nothing is stored by this app. Following your singing tempo is coming next.</p>
          <p className="mt-3">Accompanist is a free app on <a className="underline" href="https://freeappstore.online">FreeAppStore</a>. MIT licensed.</p>
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Music</h2>
          <ul className="space-y-2">
            {SONGS.map(s => <li key={s.id}><strong>{s.title}</strong> · {s.composer}. {s.edition} {s.rights}. <a className="underline" href={s.sourceUrl}>{s.source}</a> · <a className="underline" href={s.license}>terms</a></li>)}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Sound</h2>
          <p>Piano: {SOUND_BANK.name} {SOUND_BANK.version} by {SOUND_BANK.author} (<a className="underline" href={SOUND_BANK.license}>license</a>), played with SpessaSynth (<a className="underline" href="/sounds/SpessaSynth-LICENSE.txt">Apache-2.0</a>).</p>
        </Card>
      </div>
    </>
  );
}
