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
  { label: "Practice", href: "/", title: "Accompanist" },
  { label: "Songs", href: "/songs", title: "Songs — Accompanist" },
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
        {path === "/about" ? <About /> : path === "/songs" ? <Songs songId={songId} choose={id => { setSongId(id); navigate("/"); }} />
          : <Home songId={songId} onSongs={() => navigate("/songs")} />}
      </div>
    </Shell>
  );
}

type Audio = Awaited<ReturnType<typeof createAudio>>;

function Home({ songId, onSongs }: { songId: string; onSongs: () => void }) {
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
  const [tab, setTab] = useState<"Phrases" | "Bars" | "Add point" | "Voice">("Phrases");
  const [ownPoints, setOwnPoints] = useState<Point[]>(() => loadOwnPoints(songId));
  const [pointName, setPointName] = useState(""), [pointBar, setPointBar] = useState(""), [pointEnd, setPointEnd] = useState(""), [pointError, setPointError] = useState("");
  const phrases = SONGS.find(s => s.id === songId)?.phrases ?? [];
  const points = [...phrases, ...ownPoints];
  const voice = useRef<VoiceCommands | null>(null), scoreRef = useRef<HTMLDivElement>(null);
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

  // Keeps the phone screen on while the piano plays, where the browser allows it.
  useEffect(() => {
    if (!playing || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | undefined, released = false;
    const request = () => navigator.wakeLock.request("screen").then(l => { if (released) void l.release(); else lock = l; }).catch(() => {});
    const onVisible = () => { if (document.visibilityState === "visible") void request(); };
    void request(); document.addEventListener("visibilitychange", onVisible);
    return () => { released = true; document.removeEventListener("visibilitychange", onVisible); void lock?.release(); };
  }, [playing]);

  // On a phone the controls fill the top of the page: bring the score up when playing starts.
  useEffect(() => { if (playing && matchMedia("(max-width: 639px)").matches) scoreRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [playing]);

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

  const info = SONGS.find(s => s.id === songId)!;
  const keyText = transpose === 0 ? "0" : `${transpose > 0 ? "+" : "−"}${Math.abs(transpose)}`;
  const toggleLoop = () => {
    const next = !loop; setLoop(next);
    const player = audio.current?.player;
    if (player?.playing) {
      if (next && player.until === Infinity && loaded) player.until = loaded.song.duration;
      player.loop = next;
    }
  };
  const message = barError || audioError || voiceStatus;

  return (
    <>
      <div className="space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold sm:text-3xl">{info.title}</h1>
            <p className="truncate text-sm text-muted">{info.composer}{info.poet ? ` · words by ${info.poet}` : ""}</p>
          </div>
          <a className={`${button} shrink-0`} href="/songs" onClick={e => { e.preventDefault(); onSongs(); }}>Change song</a>
        </header>

        {loaded && (
          <Card>
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-1 sm:flex sm:gap-2" role="group" aria-label="Panel">
                {(["Phrases", "Bars", "Add point", "Voice"] as const).map(t => <Button key={t} className="px-1! sm:px-4!" aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</Button>)}
              </div>
              {tab === "Phrases" && (
                <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" aria-label="Start points">
                  {points.map(p => {
                    const own = ownPoints.includes(p);
                    return (
                      <li key={`${own}-${p.name}`} className="flex shrink-0 items-center">
                        <Button className={own ? "rounded-r-none" : ""} onClick={() => setBarError(playRef({ name: p.name }) ?? "")}>{p.name} <span className="font-normal text-muted">· {p.bar}{p.end !== undefined ? `–${p.end}` : ""}</span></Button>
                        {own && <Button className="rounded-l-none border-l-0 px-3" aria-label={`Remove ${p.name}`} onClick={() => removePoint(p.name)}>×</Button>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {tab === "Bars" && (
                <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); submitRange(); }}>
                  <label htmlFor="from" className="text-sm">From bar</label>
                  <input id="from" inputMode="numeric" className={`${control} w-20`} value={fromInput} aria-invalid={!!barError} onChange={e => { setFromInput(e.target.value); setBarError(""); }} />
                  <label htmlFor="to" className="text-sm">to bar</label>
                  <input id="to" inputMode="numeric" placeholder="end" className={`${control} w-20`} value={toInput} aria-invalid={!!barError} onChange={e => { setToInput(e.target.value); setBarError(""); }} />
                  <Button type="submit" primary>Play bars</Button>
                  <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={countIn} onChange={e => setCountIn(e.target.checked)} />Count-in bar</label>
                </form>
              )}
              {tab === "Add point" && (
                <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); submitPoint(); }}>
                  <div className="flex flex-col gap-1"><label htmlFor="point-name" className="text-sm">Point name</label>
                    <input id="point-name" className={`${control} w-44`} value={pointName} placeholder="second verse" aria-invalid={!!pointError} aria-describedby={pointError ? "point-error" : undefined} onChange={e => { setPointName(e.target.value); setPointError(""); }} /></div>
                  <div className="flex flex-col gap-1"><label htmlFor="point-bar" className="text-sm">Starts at bar</label>
                    <input id="point-bar" inputMode="numeric" className={`${control} w-20`} value={pointBar} placeholder={label(currentIndex())} onChange={e => { setPointBar(e.target.value); setPointError(""); }} /></div>
                  <div className="flex flex-col gap-1"><label htmlFor="point-end" className="text-sm">Ends at bar</label>
                    <input id="point-end" inputMode="numeric" className={`${control} w-20`} value={pointEnd} placeholder="end" onChange={e => { setPointEnd(e.target.value); setPointError(""); }} /></div>
                  <Button type="submit">Add point</Button>
                  {pointError && <p id="point-error" role="alert" className="w-full text-sm text-danger">{pointError}</p>}
                </form>
              )}
              {tab === "Voice" && (
                <div className="space-y-2 text-sm">
                  <p>Tap 🎙 below, then say:</p>
                  <ul className="list-disc space-y-1 pl-5 text-muted">
                    <li>“from bar 9”, “from bar 5 to 12”, “from Il tuo fedel”</li>
                    <li>“loop”, “loop bars 5 to 8”, “stop looping”, “stop at bar 20”</li>
                    <li>“slower”, “faster”, “play”, “stop”</li>
                    <li>“mark this as verse two”</li>
                  </ul>
                  <p className="text-muted">{voiceSupported ? "Headphones keep the piano out of the microphone." : "Voice commands need a browser with speech recognition, such as Chrome, Edge or Safari."}</p>
                </div>
              )}
            </div>
          </Card>
        )}

        {loadError && <p role="alert" className="text-sm text-danger">{loadError} <button className="underline" onClick={() => setRetry(r => r + 1)}>Try again</button></p>}
        {!loaded && !loadError && <p role="status" className="text-sm text-muted">Loading song…</p>}
        {loaded && <div ref={scoreRef} className="scroll-mt-20 sm:rounded-xl sm:border sm:border-line sm:bg-panel sm:p-6"><Score xml={loaded.xml} measures={loaded.measures} song={loaded.song} time={time} transpose={transpose} onBar={playBar} /></div>}

        <section aria-label="Player" className="sticky bottom-0 z-10 -mx-4 space-y-2 border-t border-line bg-panel px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:mx-0 sm:rounded-xl sm:border">
          <div className="flex items-baseline gap-3">
            <p role="status" aria-live="polite" className={`min-w-0 flex-1 truncate text-sm ${barError || audioError ? "text-danger" : "text-muted"}`}>
              {message || (active && loaded ? describe(active.first, active.last) : "")}
              {audioError && <> <button className="underline" onClick={() => void ensureAudio().catch(() => {})}>Try again</button></>}
            </p>
            <span className="text-sm tabular-nums text-muted" aria-label="Position">{formatTime(time)} / {formatTime(loaded?.song.duration ?? 0)}</span>
          </div>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <Button primary className="min-w-24" disabled={!loaded || audioState === "loading"} onClick={() => playing ? stop() : play()}>
                {audioState === "loading" ? "Loading…" : playing ? "■ Stop" : "▶ Play"}
              </Button>
              <Button className="px-3!" aria-label="From the beginning" disabled={!loaded} onClick={() => playBar(0)}>⏮</Button>
              <Button aria-pressed={loop} onClick={toggleLoop}>Loop</Button>
              <Button className="px-3!" aria-pressed={listening} aria-label={listening ? "Stop listening" : "Voice commands"} disabled={!voiceSupported} onClick={toggleVoice}>🎙{listening ? " On" : ""}</Button>
            </div>
            <div className="flex gap-3">
              <div role="group" aria-labelledby="tempo-label">
                <span id="tempo-label" className="hidden text-xs text-muted sm:block">Tempo</span>
                <div className="flex gap-1">
                  <Button className="px-3!" aria-label="Slower" onClick={() => changeSpeed(speed - .05)}>−</Button>
                  <Button className="w-16 px-1! whitespace-nowrap sm:w-14" aria-label={`Tempo ${Math.round(speed * 100)}%, reset to 100%`} onClick={() => changeSpeed(1)}><span className="sm:hidden" aria-hidden="true">♩</span>{Math.round(speed * 100)}%</Button>
                  <Button className="px-3!" aria-label="Faster" onClick={() => changeSpeed(speed + .05)}>+</Button>
                </div>
              </div>
              <div role="group" aria-labelledby="key-label">
                <span id="key-label" className="hidden text-xs text-muted sm:block">Key</span>
                <div className="flex gap-1">
                  <Button className="px-3!" aria-label="Key down a semitone" disabled={!loaded || transpose <= Math.max(-6, bounds.min)} onClick={() => changeTranspose(transpose - 1)}>−</Button>
                  <Button className="w-16 px-1! whitespace-nowrap sm:w-14" aria-label={`${pitchLabel(transpose)}, reset to original key`} disabled={!loaded} onClick={() => changeTranspose(0)}><span className="sm:hidden" aria-hidden="true">Key </span>{keyText}</Button>
                  <Button className="px-3!" aria-label="Key up a semitone" disabled={!loaded || transpose >= Math.min(6, bounds.max)} onClick={() => changeTranspose(transpose + 1)}>+</Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function Songs({ songId, choose }: { songId: string; choose: (id: string) => void }) {
  return (
    <>
      <PageHeader title="Songs" description="Choose a song to practise. The piano plays the accompaniment; you sing the tune." />
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line" aria-label="Songs">
        {SONGS.map(s => (
          <li key={s.id}>
            <button className={`flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-panel ${s.id === songId ? "bg-accent-soft" : "bg-paper"}`} aria-current={s.id === songId ? "true" : undefined} onClick={() => choose(s.id)}>
              <span className="font-semibold">{s.title}</span>
              <span className="text-sm text-muted">{s.composer}</span>
            </button>
          </li>
        ))}
      </ul>
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
