import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { initApp } from "@freeappstore/sdk";
import { Card, type NavItem, PageHeader, Shell } from "@freeappstore/sdk/ui";
import { createAudio } from "./audio";
import { parseCommand, type Command, type Ref } from "./commands";
import { beatAtTime, formatTime, timeAtBeat } from "./music";
import { loadOwnPoints, resolveRange, saveOwnPoints } from "./points";
import { pitchLabel, transposeBounds } from "./practice";
import Score from "./Score";
import { findBar, loadSong, SONGS, type LoadedSong, type Point } from "./songs";
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
  const [fromInput, setFromInput] = useState("1"), [toInput, setToInput] = useState(""), [loop, setLoop] = useState(false), [barError, setBarError] = useState("");
  const [active, setActive] = useState<{ first: number; last?: number } | null>(null);
  const [ownPoints, setOwnPoints] = useState<Point[]>(() => loadOwnPoints(songId));
  const [pointName, setPointName] = useState(""), [pointBar, setPointBar] = useState(""), [pointEnd, setPointEnd] = useState(""), [pointError, setPointError] = useState("");
  const phrases = SONGS.find(s => s.id === songId)?.phrases ?? [];
  const points = [...phrases, ...ownPoints];
  const voice = useRef<VoiceCommands | null>(null);
  const loadedRef = useRef(loaded); loadedRef.current = loaded;

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(null); setLoadError(""); setTime(0); setTranspose(0); setActive(null); setOwnPoints(loadOwnPoints(songId));
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

  const startAt = async (from: number, withCountIn = countIn, range: { until?: number; loop?: boolean } = {}) => {
    if (!loaded) return;
    const { player } = await ensureAudio();
    player.start(from, withCountIn, range);
  };
  /** Plays from measure `first`, through measure `last` if given, looping when asked. */
  const playRange = (first: number, last?: number, looping = loop) => {
    if (!loaded) return;
    const { song, measures } = loaded;
    setActive({ first, last }); setLoop(looping && last !== undefined);
    void startAt(timeAtBeat(song, measures[first].start), countIn, { until: last === undefined ? undefined : timeAtBeat(song, measures[last].end), loop: looping }).catch(() => {});
  };
  const playBar = (index: number) => playRange(index);
  /** Plays from a start reference to an optional stop reference, or returns why it can't. */
  const playRef = (from: Ref, to?: Ref, looping = loop) => {
    if (!loaded) return "The song is still loading.";
    const range = resolveRange(loaded.measures, points, phrases, from, to);
    if (typeof range === "string") return range;
    playRange(range.first, range.last, looping); return null;
  };
  const label = (index: number) => loaded?.measures[index]?.label ?? "";
  const describe = (first: number, last?: number, looping = loop) =>
    last === undefined ? `Playing from bar ${label(first)}` : `${looping ? "Looping" : "Playing"} bars ${label(first)}–${label(last)}`;
  /** The measure being played, or where playback stopped. */
  const currentIndex = () => {
    if (!loaded) return 0;
    const beat = beatAtTime(loaded.song, time + 1e-6);
    return loaded.measures.reduce((found, m, i) => m.start <= beat ? i : found, 0);
  };
  const savePoint = (point: Point) => {
    const next = [...ownPoints.filter(p => p.name.toLowerCase() !== point.name.toLowerCase()), point];
    setOwnPoints(next); saveOwnPoints(songId, next);
  };
  const removePoint = (name: string) => {
    const next = ownPoints.filter(p => p.name !== name);
    setOwnPoints(next); saveOwnPoints(songId, next);
  };
  const stop = () => audio.current?.player.stop();
  /** Resumes: inside an unfinished range it keeps the range; after one, it carries on to the end. */
  const play = () => {
    if (!loaded) return;
    const player = audio.current?.player;
    const keep = player && time < player.until ? { until: player.until, loop: player.loop } : {};
    if (!keep.until) setActive(null);
    void startAt(time >= loaded.song.duration ? 0 : time, countIn, keep).catch(() => {});
  };
  const changeSpeed = (value: number) => {
    const next = Math.round(Math.min(1.5, Math.max(.5, value)) * 100) / 100;
    setSpeed(next); audio.current?.player.setSpeed(next);
  };
  const changeTranspose = (value: number) => { setTranspose(value); audio.current?.player.setTranspose(value); };

  const run = (command: Command) => {
    if (!loaded) return "The song is still loading.";
    if (command.type === "from") {
      const range = resolveRange(loaded.measures, points, phrases, command.from, command.to);
      if (typeof range === "string") return range;
      playRange(range.first, range.last); return describe(range.first, range.last);
    }
    if (command.type === "until") {
      const here = currentIndex();
      const range = resolveRange(loaded.measures, points, phrases, { bar: Number(label(here)) }, command.to);
      if (typeof range === "string") return range;
      if (range.last === undefined || range.last < here) return "That point has already passed.";
      setToInput(label(range.last)); setActive({ first: active?.first ?? here, last: range.last });
      const player = audio.current?.player;
      if (player?.playing) player.until = timeAtBeat(loaded.song, loaded.measures[range.last].end);
      return `Stopping at the end of bar ${label(range.last)}`;
    }
    if (command.type === "loop") {
      const player = audio.current?.player;
      if (!command.on) { setLoop(false); if (player) player.loop = false; return "Loop off"; }
      if (command.from) {
        const range = resolveRange(loaded.measures, points, phrases, command.from, command.to);
        if (typeof range === "string") return range;
        const last = range.last ?? range.first;
        playRange(range.first, last, true); return describe(range.first, last, true);
      }
      setLoop(true);
      if (player?.playing) {
        if (player.until === Infinity) player.until = loaded.song.duration;
        player.loop = true;
      }
      return "Loop on";
    }
    if (command.type === "mark") {
      const bar = command.bar ?? Number(label(currentIndex()));
      if (findBar(loaded.measures, bar) < 0) return `There is no bar ${bar}.`;
      savePoint({ name: command.name, bar }); return `Saved “${command.name}” at bar ${bar}`;
    }
    if (command.type === "stop") { stop(); return "Stopped"; }
    if (command.type === "tempo") { changeSpeed(speed * command.factor); return command.factor < 1 ? "Slower" : "Faster"; }
    play(); return "Playing";
  };
  const runRef = useRef(run); runRef.current = run;
  const namesRef = useRef<string[]>([]); namesRef.current = points.map(p => p.name);

  const toggleVoice = () => {
    if (listening) { voice.current?.stop(); return; }
    void ensureAudio().catch(() => {});
    voice.current ??= new VoiceCommands(phrase => {
      const command = parseCommand(phrase, namesRef.current);
      setVoiceStatus(`Heard “${phrase}” · ${command ? runRef.current(command) : "not a command"}`);
    }, (on, error) => { setListening(on); setVoiceStatus(error ?? (on ? "Listening for commands…" : "")); });
    voice.current.start();
  };

  const bounds = loaded ? transposeBounds(loaded.song) : { min: 0, max: 0 };
  const keys = Array.from({ length: Math.min(6, bounds.max) - Math.max(-6, bounds.min) + 1 }, (_, i) => Math.max(-6, bounds.min) + i);
  const wholeNumber = (value: string) => /^\s*\d+\s*$/.test(value) ? Number(value) : null;
  const submitRange = () => {
    const from = wholeNumber(fromInput), to = toInput.trim() ? wholeNumber(toInput) : undefined;
    const error = from === null || to === null ? "Enter whole bar numbers." : playRef({ bar: from }, to === undefined ? undefined : { bar: to }, loop && to !== undefined);
    setBarError(error ?? "");
  };
  const submitPoint = () => {
    const name = pointName.trim(), bar = wholeNumber(pointBar || label(currentIndex())), end = pointEnd.trim() ? wholeNumber(pointEnd) : undefined;
    let error = "";
    if (!name) error = "Give the point a name, such as “second verse”.";
    else if (bar === null || end === null) error = "Enter whole bar numbers.";
    else if (!loaded || findBar(loaded.measures, bar) < 0 || (end !== undefined && findBar(loaded.measures, end) < findBar(loaded.measures, bar))) error = "Choose bars from this song, with the last bar after the first.";
    setPointError(error);
    if (error || bar === null || end === null) return;
    savePoint({ name, bar, ...(end === undefined ? {} : { end }) });
    setPointName(""); setPointBar(""); setPointEnd("");
  };

  return (
    <>
      <PageHeader title="Accompanist" description="Your piano accompanist. Choose a song, then say “from bar 5”, “from bar 5 to 12”, “loop” or “stop”." />
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
              <span className="ml-auto text-sm tabular-nums text-muted" aria-label="Position">{formatTime(time)} / {formatTime(loaded?.song.duration ?? 0)}</span>
            </div>
            <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); submitRange(); }}>
              <label htmlFor="from" className="text-sm">From bar</label>
              <input id="from" inputMode="numeric" className={`${control} w-20`} value={fromInput} aria-invalid={!!barError} aria-describedby={barError ? "bar-error" : undefined} onChange={e => { setFromInput(e.target.value); setBarError(""); }} />
              <label htmlFor="to" className="text-sm">to bar</label>
              <input id="to" inputMode="numeric" placeholder="end" className={`${control} w-20`} value={toInput} aria-invalid={!!barError} aria-describedby={barError ? "bar-error" : undefined} onChange={e => { setToInput(e.target.value); setBarError(""); }} />
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={loop} onChange={e => { setLoop(e.target.checked); const player = audio.current?.player; if (player) player.loop = e.target.checked && player.until < Infinity; }} />Loop</label>
              <Button type="submit" disabled={!loaded}>Play bars</Button>
              {active && loaded && <span className="text-sm text-muted">{describe(active.first, active.last)}</span>}
            </form>
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <Button aria-pressed={listening} disabled={!voiceSupported} onClick={toggleVoice}>{listening ? "🎙 Listening — tap to stop" : "🎙 Voice commands"}</Button>
              <p role="status" aria-live="polite" className="text-sm text-muted">
                {!voiceSupported ? "Voice commands need a browser with speech recognition, such as Chrome, Edge or Safari." : voiceStatus || "Say “from bar 9”, “from bar 5 to 12”, “from” and a start point’s name, “stop at bar 20”, “loop”, “mark this as verse two”, “play”, “stop”, “slower” or “faster”. Headphones keep the piano out of the microphone."}
              </p>
            </div>
            {barError && <p id="bar-error" role="alert" className="text-sm text-danger">{barError}</p>}
            {audioError && <p role="alert" className="text-sm text-danger">{audioError} <button className="underline" onClick={() => void ensureAudio().catch(() => {})}>Try again</button></p>}
          </div>
        </Card>

        {loaded && (
          <Card>
            <div className="space-y-3">
              <h2 className="text-base font-semibold">Start points</h2>
              <p className="text-sm text-muted">Tap one, or say “from” and its name. Phrases are named by their first words; add your own below.</p>
              <ul className="flex flex-wrap gap-2" aria-label="Start points">
                {points.map(p => {
                  const own = ownPoints.includes(p);
                  return (
                    <li key={`${own}-${p.name}`} className="flex items-center">
                      <Button className={own ? "rounded-r-none" : ""} onClick={() => setBarError(playRef({ name: p.name }) ?? "")}>{p.name} <span className="font-normal text-muted">· bar {p.bar}{p.end !== undefined ? `–${p.end}` : ""}</span></Button>
                      {own && <Button className="rounded-l-none border-l-0 px-3" aria-label={`Remove ${p.name}`} onClick={() => removePoint(p.name)}>×</Button>}
                    </li>
                  );
                })}
              </ul>
              <form className="flex flex-wrap items-end gap-2 border-t border-line pt-3" onSubmit={e => { e.preventDefault(); submitPoint(); }}>
                <div className="flex flex-col gap-1"><label htmlFor="point-name" className="text-sm">Point name</label>
                  <input id="point-name" className={`${control} w-44`} value={pointName} placeholder="second verse" aria-invalid={!!pointError} aria-describedby={pointError ? "point-error" : undefined} onChange={e => { setPointName(e.target.value); setPointError(""); }} /></div>
                <div className="flex flex-col gap-1"><label htmlFor="point-bar" className="text-sm">Starts at bar</label>
                  <input id="point-bar" inputMode="numeric" className={`${control} w-20`} value={pointBar} placeholder={label(currentIndex())} onChange={e => { setPointBar(e.target.value); setPointError(""); }} /></div>
                <div className="flex flex-col gap-1"><label htmlFor="point-end" className="text-sm">Ends at bar</label>
                  <input id="point-end" inputMode="numeric" className={`${control} w-20`} value={pointEnd} placeholder="end" onChange={e => { setPointEnd(e.target.value); setPointError(""); }} /></div>
                <Button type="submit">Add point</Button>
              </form>
              {pointError && <p id="point-error" role="alert" className="text-sm text-danger">{pointError}</p>}
            </div>
          </Card>
        )}

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
          <p>Accompanist plays piano accompaniment for singers and starts from any bar when you ask. Choose a song, turn on voice commands and say “from bar 5”, “from bar 5 to 12”, “from” and the name of a phrase, “stop at bar 20”, “loop”, “mark this as verse two”, “play”, “stop”, “slower” or “faster”. Everything also works with the buttons. Points you add are kept on this device only.</p>
          <p className="mt-3">Speech recognition is provided by your browser; in some browsers, such as Chrome, the audio is sent to the browser maker’s speech service. Nothing is stored by this app. Following your singing tempo is coming next.</p>
          <p className="mt-3">Accompanist is a free app on <a className="underline" href="https://freeappstore.online">FreeAppStore</a>. MIT licensed.</p>
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Music</h2>
          <ul className="space-y-2">
            {SONGS.map(s => <li key={s.id}><strong>{s.title}</strong> · {s.composer}{s.poet ? `, words by ${s.poet}` : ""}. {s.edition} {s.rights}. <a className="underline" href={s.sourceUrl}>{s.source}</a> · <a className="underline" href={s.license}>terms</a></li>)}
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
