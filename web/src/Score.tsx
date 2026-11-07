import { useEffect, useMemo, useRef, useState } from 'react';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { beatAtTime, type Song } from './music';
import type { Measure } from './songs';

const PAGE_SIZE = 4;
const button = 'min-h-11 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink disabled:opacity-40';

/** MusicXML notation with a cursor and page turns that follow playback (adapted from scoreplay's OriginalScore). */
export default function Score({ xml, measures, song, time, transpose, onBar }: { xml: string; measures: Measure[]; song: Song; time: number; transpose: number; onBar: (index: number) => void }) {
  const [page, setPage] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState(''), [follow, setFollow] = useState(true);
  const [ready, setReady] = useState(0), [rendered, setRendered] = useState(0);
  const container = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null);
  const renderer = useRef<OpenSheetMusicDisplay | null>(null);
  const positions = useRef<number[]>([]), cursorIndex = useRef(0), redraw = useRef(() => {});
  const pages = Math.ceil(measures.length / PAGE_SIZE), safePage = Math.min(page, pages - 1);
  const visible = useMemo(() => measures.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE), [measures, safePage]);
  const beat = beatAtTime(song, time);
  const found = measures.findIndex(m => m.end > beat);
  const current = found < 0 ? measures.length - 1 : found;
  useEffect(() => { if (follow) setPage(Math.floor(current / PAGE_SIZE)); }, [current, follow]);
  useEffect(() => {
    let cancelled = false, osmd: OpenSheetMusicDisplay | undefined, observer: ResizeObserver | undefined, frame = 0;
    setLoading(true); setError(''); renderer.current = null;
    const el = container.current!;
    void import('opensheetmusicdisplay').then(async ({ OpenSheetMusicDisplay, IntervalTransposeCalculator }) => {
      if (cancelled) return;
      el.replaceChildren();
      osmd = new OpenSheetMusicDisplay(el, { autoResize: false, backend: 'svg', drawTitle: false, drawSubtitle: false, drawComposer: false, drawPartNames: false, drawMeasureNumbers: true, drawMeasureNumbersOnlyAtSystemStart: false, followCursor: false });
      osmd.setLogLevel('error');
      await osmd.load(new DOMParser().parseFromString(xml, 'application/xml'));
      if (cancelled) return;
      osmd.TransposeCalculator = new IntervalTransposeCalculator();
      osmd.Sheet.Transpose = transpose;
      renderer.current = osmd; setReady(value => value + 1);
      let width = el.clientWidth;
      observer = new ResizeObserver(() => {
        if (el.clientWidth === width) return;
        width = el.clientWidth; cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => { if (!cancelled) redraw.current(); });
      });
      observer.observe(el);
    }).catch(() => { if (!cancelled) { setLoading(false); setError('The score could not be displayed. Playback still works.'); } });
    return () => { cancelled = true; observer?.disconnect(); cancelAnimationFrame(frame); osmd?.cursor?.Dispose(); osmd?.clear(); renderer.current = null; };
  }, [xml, transpose]);
  useEffect(() => {
    const osmd = renderer.current;
    if (!osmd) return;
    const draw = () => {
      try {
        // Page by source index; OSMD renumbers pickup measures to zero.
        osmd.EngravingRules.MinMeasureToDrawNumber = 0;
        osmd.EngravingRules.MaxMeasureToDrawNumber = 0;
        osmd.EngravingRules.MinMeasureToDrawIndex = safePage * PAGE_SIZE;
        osmd.EngravingRules.MaxMeasureToDrawIndex = Math.min((safePage + 1) * PAGE_SIZE - 1, measures.length - 1);
        osmd.render(); osmd.cursor.hide(); osmd.cursor.reset();
        const iterator = osmd.cursor.Iterator.clone();
        positions.current = [];
        while (!iterator.EndReached && positions.current.length < 20000) {
          positions.current.push(iterator.CurrentSourceTimestamp.RealValue * 4);
          iterator.moveToNext();
        }
        cursorIndex.current = 0;
        osmd.cursor.cursorElement.alt = 'Playback cursor';
        setLoading(false); setError(''); setRendered(value => value + 1);
      } catch { setLoading(false); setError('The score could not be displayed. Playback still works.'); }
    };
    redraw.current = draw; draw();
    return () => { redraw.current = () => {}; };
  }, [measures, safePage, ready]);
  useEffect(() => {
    const cursor = renderer.current?.cursor;
    if (!cursor || !positions.current.length || !visible.length) return;
    if (beat < visible[0].start || beat >= visible[visible.length - 1].end) { cursor.hide(); return; }
    let index = positions.current.findIndex(value => value > beat + .001);
    index = index < 0 ? positions.current.length - 1 : Math.max(0, index - 1);
    if (index < cursorIndex.current) { cursor.reset(); cursorIndex.current = 0; }
    while (cursorIndex.current < index) { cursor.next(); cursorIndex.current++; }
    cursor.show();
    cursor.cursorElement.dataset.measure = String(cursor.Iterator.CurrentMeasureIndex + 1);
    if (follow && viewport.current) {
      const mark = cursor.cursorElement.getBoundingClientRect(), view = viewport.current.getBoundingClientRect();
      if (mark.right > view.right - 20 || mark.left < view.left + 20) viewport.current.scrollLeft += mark.left - view.left - 40;
    }
  }, [beat, safePage, rendered, follow, visible]);
  return <section className="space-y-4" aria-label="Score">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold">Bar {measures[current]?.label} of {measures[measures.length - 1]?.label}</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />Turn pages with playback</label></div>
    {loading && <p role="status" className="text-sm text-muted">Loading score…</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div ref={viewport} className="overflow-x-auto rounded-xl border border-line bg-score-paper" tabIndex={0} aria-label="Scrollable sheet music"><div ref={container} className="relative min-h-40 min-w-[640px] text-score-ink" role="img" aria-label={`Score, bars ${visible[0]?.label} to ${visible[visible.length - 1]?.label}`} /></div>
    <div className="flex flex-wrap items-center justify-between gap-3"><button className={button} disabled={safePage === 0} onClick={() => { setFollow(false); setPage(safePage - 1); }}>← Previous page</button><span className="text-sm text-muted">Page {safePage + 1} of {pages}</span><button className={button} disabled={safePage >= pages - 1} onClick={() => { setFollow(false); setPage(safePage + 1); }}>Next page →</button></div>
    <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted">Play from bar</span>{visible.map((m, i) => <button key={m.number} className={`${button} ${safePage * PAGE_SIZE + i === current ? 'border-accent bg-accent-soft' : ''}`} aria-label={`Play from bar ${m.label}`} aria-current={safePage * PAGE_SIZE + i === current ? 'step' : undefined} onClick={() => onBar(safePage * PAGE_SIZE + i)}>{m.label}</button>)}</div>
  </section>;
}
