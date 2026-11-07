export type Command = { type: 'play' } | { type: 'stop' } | { type: 'from'; bar: number } | { type: 'tempo'; factor: number };

const UNITS: Record<string, number> = { zero: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, fore: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Reads "12", "twelve", "twenty one" or "one hundred and three" from the start of the words. */
function readNumber(words: string[]): number | null {
  if (/^\d+$/.test(words[0] ?? '')) return Number(words[0]);
  let current = 0, seen = false;
  for (const word of words) {
    if (word in UNITS && !(seen && current % 10)) { current += UNITS[word]; seen = true; }
    else if (word in TENS && !(current % 100)) { current += TENS[word]; seen = true; }
    else if (word === 'hundred' && seen) current = (current || 1) * 100;
    else if (word === 'and' && seen) continue;
    else break;
  }
  return seen ? current : null;
}

/** Turns one recognised phrase into a command. Bar commands take priority over the words inside them ("play from bar 9"). */
export function parseCommand(transcript: string): Command | null {
  const words = transcript.toLowerCase().replace(/-/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const text = words.join(' ');
  const bar = words.findIndex(w => ['bar', 'bars', 'measure', 'measures', 'bah', 'barr'].includes(w));
  if (bar >= 0) { const n = readNumber(words.slice(bar + 1)); if (n !== null) return { type: 'from', bar: n }; }
  if (/\b(from the (beginning|top|start)|start over|from the very beginning)\b/.test(text)) return { type: 'from', bar: 1 };
  if (/\b(stop|pause|wait|hold on)\b/.test(text)) return { type: 'stop' };
  if (/\b(slower|slow down)\b/.test(text)) return { type: 'tempo', factor: .9 };
  if (/\b(faster|speed up)\b/.test(text)) return { type: 'tempo', factor: 1.1 };
  if (/\b(play|start|go|continue|resume)\b/.test(text)) return { type: 'play' };
  return null;
}
