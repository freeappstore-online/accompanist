/** Where to start or stop: a printed bar, a named point, the nth phrase, or the start of the song. */
export type Ref = { bar: number } | { name: string } | { phrase: number } | { start: true };
export type Command =
  | { type: 'play' } | { type: 'stop' } | { type: 'tempo'; factor: number }
  | { type: 'from'; from: Ref; to?: Ref }
  | { type: 'until'; to: Ref }
  | { type: 'loop'; on: boolean; from?: Ref; to?: Ref }
  | { type: 'mark'; name: string; bar?: number };

const UNITS: Record<string, number> = { zero: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, fore: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const BAR = new Set(['bar', 'bars', 'measure', 'measures', 'bah', 'barr']);
const UNTIL = new Set(['to', 'till', 'until', 'through', 'thru']);

/** Reads "12", "twelve", "twenty one" or "one hundred and three" from the start of the words. */
function readNumber(words: string[]): { value: number; used: number } | null {
  if (/^\d+$/.test(words[0] ?? '')) return { value: Number(words[0]), used: 1 };
  let current = 0, used = 0, seen = false;
  for (const word of words) {
    if (word in UNITS && !(seen && current % 10)) { current += UNITS[word]; seen = true; }
    else if (word in TENS && !(current % 100)) { current += TENS[word]; seen = true; }
    else if (word === 'hundred' && seen) current = (current || 1) * 100;
    else if (word === 'and' && seen) { used++; continue; }
    else break;
    used++;
  }
  return seen ? { value: current, used } : null;
}

export const normalize = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[-‿_]/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

/** The point name the words best refer to. Names are matched loosely, as speech recognition hears foreign words imperfectly. */
export function matchName(words: string[], names: string[]): string | null {
  let best: { name: string; score: number } | null = null;
  for (const name of names) {
    const [, base, suffix] = name.match(/^(.*?)(?: \((\d+)\))?$/)!;
    const target = normalize(base);
    if (!target.length) continue;
    const hits = target.filter(w => words.includes(w)).length;
    // Editions sometimes split a word into unhyphenated syllables ("Ho ly fair"): compare run together too.
    const joined = words.join('').includes(target.join(''));
    if (!joined && hits < Math.min(2, target.length)) continue;
    let score = joined ? 1 : hits / target.length;
    // "the second Caro mio ben": a matching occurrence number wins over the plain name.
    const wanted = words.map(w => ORDINALS[w] ?? (/^\d+$/.test(w) ? Number(w) : UNITS[w])).find(n => n && n > 1);
    if (wanted) score += Number(suffix ?? 1) === wanted ? .5 : -.25;
    if (score >= .6 && (!best || score > best.score)) best = { name, score };
  }
  return best?.name ?? null;
}

/** A start or stop point within some words: "bar 12", "12" (after "to"), "the beginning", "phrase 3" or a point name. */
function readRef(words: string[], names: string[], bareNumber: boolean): Ref | null {
  const bar = words.findIndex(w => BAR.has(w));
  if (bar >= 0) { const n = readNumber(words.slice(bar + 1)); return n ? { bar: n.value } : null; }
  const phrase = words.indexOf('phrase');
  if (phrase >= 0) {
    const n = readNumber(words.slice(phrase + 1))?.value ?? ORDINALS[words[phrase - 1]];
    if (n) return { phrase: n };
  }
  const text = words.join(' ');
  if (/\bthe (very )?(beginning|top|start)\b|\bstart over\b/.test(text)) return { start: true };
  const name = matchName(words, names);
  if (name) return { name };
  if (bareNumber) { const n = readNumber(words); if (n && n.used === words.length) return { bar: n.value }; }
  return null;
}

/** "from A to B": both ends, when the words split cleanly at a "to"; otherwise one start point. */
function readRange(words: string[], names: string[]): { from: Ref; to?: Ref } | null {
  for (let i = 1; i < words.length - 1; i++) {
    if (!UNTIL.has(words[i])) continue;
    const from = readRef(words.slice(0, i), names, false), to = readRef(words.slice(i + 1), names, true);
    if (from && to) return { from, to };
  }
  const from = readRef(words, names, false);
  return from ? { from } : null;
}

/** Turns one recognised phrase into a command. `names` are the song's start points, so "from Il tuo fedel" works. */
export function parseCommand(transcript: string, names: string[] = []): Command | null {
  const words = normalize(transcript);
  const text = words.join(' ');

  const mark = words.findIndex(w => ['mark', 'call', 'name', 'save'].includes(w));
  if (mark >= 0 && mark <= 1) {
    let rest = words.slice(mark + 1), bar: number | undefined;
    if (BAR.has(rest[0])) { const n = readNumber(rest.slice(1)); if (!n) return null; bar = n.value; rest = rest.slice(1 + n.used); }
    else if (['this', 'here', 'it'].includes(rest[0])) rest = rest.slice(1);
    if (['as', 'is'].includes(rest[0])) rest = rest.slice(1);
    const name = transcript.trim().split(/\s+/).slice(-rest.length).join(' ').replace(/[.!?]+$/, '');
    if (rest.length) return { type: 'mark', name, bar };
  }

  if (/\b(stop|no|cancel|end|don t) (the )?loop(ing)?\b|\bno more loop/.test(text)) return { type: 'loop', on: false };
  const loop = words.findIndex(w => w === 'loop' || w === 'repeat');
  if (loop >= 0) return { type: 'loop', on: true, ...readRange(words.slice(loop + 1), names) };

  const until = text.match(/\b(stop at|stop after|until|till|up to|only to|end at)\b/);
  if (until) {
    const after = normalize(text.slice(until.index! + until[0].length));
    const to = readRef(after, names, true);
    if (to) return { type: 'until', to };
  }

  // A point name alone could be the singer singing the words, so it needs "from", "play", "go to"…
  const range = readRange(words, names);
  if (range && (!('name' in range.from) || range.to || /\b(from|play|go to|back to|start at|sing)\b/.test(text))) return { type: 'from', ...range };
  if (/\b(stop|pause|wait|hold on)\b/.test(text)) return { type: 'stop' };
  if (/\b(slower|slow down)\b/.test(text)) return { type: 'tempo', factor: .9 };
  if (/\b(faster|speed up)\b/.test(text)) return { type: 'tempo', factor: 1.1 };
  if (/\b(play|start|go|continue|resume)\b/.test(text)) return { type: 'play' };
  return null;
}
