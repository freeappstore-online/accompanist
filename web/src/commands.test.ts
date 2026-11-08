import { expect, it } from 'vitest';
import { matchName, parseCommand } from './commands';

const NAMES = ['Caro mio ben', 'Caro mio ben (2)', 'Il tuo fedel', 'Verse two'];

it.each([
  ['from bar 9', { type: 'from', from: { bar: 9 } }],
  ['Play from bar nine.', { type: 'from', from: { bar: 9 } }],
  ['measure twenty-one', { type: 'from', from: { bar: 21 } }],
  ['go to bar for', { type: 'from', from: { bar: 4 } }],
  ['from bar to', { type: 'from', from: { bar: 2 } }],
  ['from bar one hundred and three', { type: 'from', from: { bar: 103 } }],
  ['from bar twelve please', { type: 'from', from: { bar: 12 } }],
  ['from the beginning', { type: 'from', from: { start: true } }],
  ['take it from the top', { type: 'from', from: { start: true } }],
  ['from bar 5 to 12', { type: 'from', from: { bar: 5 }, to: { bar: 12 } }],
  ['from bar twenty to thirty', { type: 'from', from: { bar: 20 }, to: { bar: 30 } }],
  ['play bars 5 through bar 8', { type: 'from', from: { bar: 5 }, to: { bar: 8 } }],
  ['from il tuo fedel', { type: 'from', from: { name: 'Il tuo fedel' } }],
  ['play the second caro mio ben', { type: 'from', from: { name: 'Caro mio ben (2)' } }],
  ['from Il tuo fedel to bar 20', { type: 'from', from: { name: 'Il tuo fedel' }, to: { bar: 20 } }],
  ['go to phrase three', { type: 'from', from: { phrase: 3 } }],
  ['from the third phrase', { type: 'from', from: { phrase: 3 } }],
  ['stop at bar 20', { type: 'until', to: { bar: 20 } }],
  ['until verse two', { type: 'until', to: { name: 'Verse two' } }],
  ['loop', { type: 'loop', on: true }],
  ['loop bars 5 to 8', { type: 'loop', on: true, from: { bar: 5 }, to: { bar: 8 } }],
  ['stop looping', { type: 'loop', on: false }],
  ['mark bar 12 as verse two', { type: 'mark', name: 'verse two', bar: 12 }],
  ['mark this as the high note.', { type: 'mark', name: 'the high note' }],
  ['stop', { type: 'stop' }],
  ['wait', { type: 'stop' }],
  ['a bit slower', { type: 'tempo', factor: .9 }],
  ['faster', { type: 'tempo', factor: 1.1 }],
  ['play', { type: 'play' }],
  ['start', { type: 'play' }],
  ['continue', { type: 'play' }],
])('%s', (phrase, command) => expect(parseCommand(phrase, NAMES)).toEqual(command));

it('ignores singing, even the words a point is named after', () => {
  expect(parseCommand('three blind mice see how they run', NAMES)).toBeNull();
  expect(parseCommand('the bar was closed', NAMES)).toBeNull();
  expect(parseCommand('caro mio ben credimi almen', NAMES)).toBeNull();
});

it('matches names loosely but not by one shared word', () => {
  expect(matchName(['carol', 'mio', 'ben'], NAMES)).toBe('Caro mio ben');
  expect(matchName(['il', 'tuo', 'fedele'], NAMES)).toBe('Il tuo fedel');
  expect(matchName(['the', 'tuo'], NAMES)).toBeNull();
});

it('matches a name whose syllables the edition left unhyphenated', () => {
  expect(parseCommand('from holy fair', ['Ho ly fair'])).toEqual({ type: 'from', from: { name: 'Ho ly fair' } });
});
